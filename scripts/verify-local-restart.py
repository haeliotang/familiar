import http.cookiejar
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


repo = Path(__file__).resolve().parents[1]
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
with_audio = '--with-memory-audio' in sys.argv


def request(path, method='GET', body=None, extra_headers=None):
    data = body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None
    headers = {'Content-Type': 'application/octet-stream' if isinstance(body, bytes) else 'application/json'} if body is not None else {}
    headers.update(extra_headers or {})
    with client.open(urllib.request.Request(f'http://127.0.0.1:{port}{path}', data=data, method=method, headers=headers), timeout=5) as response:
        return json.load(response)


def start(directory, log):
    process = subprocess.Popen(['node', '--import', str(repo / 'node_modules/tsx/dist/loader.mjs'), str(repo / 'server/start-local.ts')], cwd=directory, env={**os.environ, 'PORT': str(port)}, stdout=log, stderr=log)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'service exited during startup: {process.returncode}')
        try:
            request('/v1/sessions/current')
            return process
        except urllib.error.HTTPError as error:
            if error.code == 401:
                return process
            process.kill()
            process.wait()
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.1)
    process.kill()
    process.wait()
    raise RuntimeError('service did not start within 20 seconds')


with tempfile.TemporaryDirectory(prefix='familiar-restart-') as directory:
    if with_audio:
        (Path(directory) / '.models').symlink_to(repo / '.models', target_is_directory=True)
    with tempfile.TemporaryFile() as log:
        process = None
        try:
            process = start(directory, log)
            request('/v1/sessions/anonymous', 'POST', {})
            person_id = request('/v1/persons', 'POST', {})['personId']
            if with_audio:
                audio = (repo / '.models/kokoro-general.wav').read_bytes()
                asset = request('/v1/assets/upload-intents', 'POST', {'personId': person_id, 'kind': 'user_memory_audio', 'mediaType': 'audio/wav', 'sizeBytes': len(audio)})
                request(asset['uploadUrl'], 'PUT', audio)
                request('/v1/assets/' + asset['assetId'] + '/complete', 'POST')
                transcript_path = '/v1/assets/' + asset['assetId'] + '/transcription'
                transcript = request(transcript_path, 'POST')['transcript']
                assert transcript['text'] and transcript['segments']
                assert transcript['sourceAssetId'] == asset['assetId']
                assert transcript['modelId'] == 'whisper-tiny-int8'
                generic = request(f'/v1/persons/{person_id}/episodes', 'POST', {}, {'Idempotency-Key': 'unconfirmed-memory'})
                generic_manifest = request('/v1/episodes/' + generic['episodeId'])['manifest']
                assert generic_manifest['cue'] == 'general' and generic_manifest['evidenceId'] is None
                confirmation = request(transcript_path + '/confirm', 'POST', {'text': '合成测试：我记得他总会回头等我'})
                episode = request(f'/v1/persons/{person_id}/episodes', 'POST', {}, {'Idempotency-Key': 'confirmed-memory'})
                manifest = request('/v1/episodes/' + episode['episodeId'])['manifest']
                assert manifest['cue'] == 'wait' and manifest['evidenceId'] == confirmation['evidenceId']
            else:
                request(f'/v1/persons/{person_id}/memories', 'POST', {'text': '合成重启测试：回头等我'})
            process.send_signal(signal.SIGTERM)
            assert process.wait(timeout=15) == 0, 'service did not shut down cleanly'
            process = start(directory, log)
            assert request('/v1/persons')['persons'][0]['personId'] == person_id
            if with_audio:
                assert request(transcript_path)['transcript'] == transcript
                assert request(f'/v1/persons/{person_id}/assets')['assets'][0]['reviewState'] == 'confirmed'
            deleted = request(f'/v1/persons/{person_id}', 'DELETE')
            assert request('/v1/deletions/' + deleted['deletionJobId'])['status'] == 'completed'
            if with_audio:
                assert list((Path(directory) / '.local-assets').iterdir()) == []
                try:
                    request(transcript_path)
                    raise AssertionError('deleted transcript remained accessible')
                except urllib.error.HTTPError as error:
                    assert error.code == 404
            process.send_signal(signal.SIGINT)
            assert process.wait(timeout=15) == 0, 'service did not shut down cleanly'
            print('Local restart passed: SIGTERM/SIGINT exit 0, persisted session/person, completed deletion.' + (' Real offline ASR, confirmation, evidence-linked episode and transcript deletion passed.' if with_audio else ''))
        except Exception:
            log.seek(0)
            print(log.read().decode(errors='replace'))
            raise
        finally:
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()

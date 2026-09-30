"""Measure root motion from the official Standard animation archive."""
import hashlib
import json
from pathlib import Path
import struct
import sys
from zipfile import ZipFile

archive = Path(sys.argv[1])
with ZipFile(archive) as package:
    data = package.read('Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard_RM.glb')
size = struct.unpack_from('<I', data, 12)[0]
document = json.loads(data[20:20 + size])
binary = data[28 + size:]
clip = next(clip for clip in document['animations'] if clip['name'] == 'Walk_Loop')
channel = next(channel for channel in clip['channels'] if document['nodes'][channel['target']['node']]['name'] == 'root' and channel['target']['path'] == 'translation')
sampler = clip['samplers'][channel['sampler']]

def values(index, components):
    accessor = document['accessors'][index]
    if accessor['componentType'] != 5126:
        raise ValueError('Expected float root-motion data')
    view = document['bufferViews'][accessor['bufferView']]
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride', components * 4)
    return [struct.unpack_from('<' + 'f' * components, binary, start + frame * stride) for frame in range(accessor['count'])]

times = values(sampler['input'], 1)
positions = values(sampler['output'], 3)
delta = [positions[-1][axis] - positions[0][axis] for axis in range(3)]
duration = times[-1][0] - times[0][0]
if abs(delta[0]) > .001 or abs(delta[1]) > .001 or delta[2] <= 0 or duration <= 0:
    raise ValueError('Unexpected walking direction or duration')
result = {'source': 'https://quaternius.itch.io/universal-animation-library', 'variant': 'Standard_RM', 'sourceGlbSha256': hashlib.sha256(data).hexdigest(), 'clip': 'Walk_Loop', 'durationSec': duration, 'rootDisplacementMetres': delta, 'forwardMetresPerSec': delta[2] / duration, 'status': 'source motion measurement; target foot sliding still requires review'}
target = Path(__file__).resolve().parent.parent / 'public/assets/quaternius/animation-library-v3/walking-motion.json'
target.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))

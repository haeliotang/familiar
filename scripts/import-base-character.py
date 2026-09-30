"""Import the official free Standard ZIP as one self-contained adult GLB.

Usage: python3 scripts/import-base-character.py '/path/to/Universal Base Characters[Standard].zip'
Requires the project's existing Node and sharp installation. Does not import animations.
"""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
from zipfile import ZipFile

root = Path(__file__).resolve().parent.parent
archive = Path(sys.argv[1])
outfit = '--outfit' in sys.argv[2:]
female = '--female' in sys.argv[2:]
gender = 'female' if female else 'male'
output = root / (f'public/assets/quaternius/peasant-{gender}-v1' if outfit else ('public/assets/quaternius/base-female-v1' if female else 'public/assets/quaternius/base-character-v1'))
prefix = ('Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits/' if outfit else 'Universal Base Characters[Standard]/Base Characters/Godot - UE/')
name = ('Female_Peasant' if female else 'Male_Peasant') if outfit else ('Superhero_Female_FullBody' if female else 'Superhero_Male_FullBody')
sharp_script = """
const sharp = require('sharp');
const chunks = [];
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', async () => {
  try { process.stdout.write(await sharp(Buffer.concat(chunks)).resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).png().toBuffer()) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
});
"""
with ZipFile(archive) as package:
    document = json.loads(package.read(prefix + name + '.gltf'))
    data = bytearray(package.read(prefix + name + '.bin'))
    original = document['buffers']
    if len(original) != 1 or original[0]['byteLength'] != len(data):
        raise ValueError('Unexpected model buffers')
    repairs = {}
    for image in document['images']:
        uri = image.pop('uri')
        resolved = uri
        if prefix + resolved not in package.namelist():
            # This official export adds _png to two normal map references.
            resolved = uri.replace('_png.png', '.png')
            if prefix + resolved not in package.namelist():
                raise ValueError('Missing texture: ' + uri)
            repairs[uri] = resolved
        texture = subprocess.run(['node', '-e', sharp_script], cwd=root,
                                 input=package.read(prefix + resolved),
                                 stdout=subprocess.PIPE, check=True).stdout
        data.extend(b'\0' * (-len(data) % 4))
        image['bufferView'] = len(document['bufferViews'])
        image['mimeType'] = 'image/png'
        document['bufferViews'].append({'buffer': 0, 'byteOffset': len(data), 'byteLength': len(texture)})
        data.extend(texture)
    document['buffers'] = [{'byteLength': len(data)}]
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    data.extend(b'\0' * (-len(data) % 4))
    glb = (struct.pack('<III', 0x46546c67, 2, 28 + len(encoded) + len(data))
           + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded
           + struct.pack('<II', len(data), 0x004e4942) + data)
    triangles = sum(document['accessors'][primitive['indices']]['count'] // 3
                    for mesh in document['meshes'] for primitive in mesh['primitives'])
    report = {
        'source': 'https://quaternius.itch.io/modular-character-outfits-fantasy' if outfit else 'https://quaternius.itch.io/universal-base-characters',
        'license': 'CC0-1.0', 'importedAt': '2026-09-30',
        'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
        'glbSha256': hashlib.sha256(glb).hexdigest(),
        'model': name, 'triangles': triangles,
        'skins': len(document.get('skins', [])),
        'joints': len(document['skins'][0]['joints']),
        'animations': [clip.get('name') for clip in document.get('animations', [])],
        'maxTextureEdge': 2048, 'textureReferenceRepairs': repairs,
        'status': 'candidate; requires animation, visual and device review before release',
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / ('outfit.glb' if outfit else f'adult-{gender}.glb')).write_bytes(glb)
    license_path = 'Modular Character Outfits - Fantasy[Standard]/License_Standard.txt' if outfit else 'Universal Base Characters[Standard]/License_Standard.txt'
    (output / 'LICENSE.txt').write_bytes(package.read(license_path))
    (output / 'provenance.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))

import struct,json,pathlib,hashlib,copy
original=pathlib.Path('/Applications/Monday MUSE AI.app/Contents/Resources/app.asar');f=original.open('rb');n=struct.unpack('<4I',f.read(16));old_header=f.read(n[3]);header=json.loads(old_header);base=8+n[1]
files={}
def flatten(d,p=''):
 for k,v in d['files'].items():
  q=p+k
  if 'files' in v:flatten(v,q+'/')
  elif not v.get('unpacked'):
   f.seek(base+int(v['offset']));files[q]=f.read(v['size'])
flatten(header)
for p in pathlib.Path('work/app').rglob('*'):
 if p.is_file():files[str(p.relative_to('work/app'))]=p.read_bytes()
def entry(q):
 d=header
 parts=q.split('/')
 for k in parts[:-1]:d=d['files'].setdefault(k,{'files':{}})
 return d['files'].setdefault(parts[-1],{})
offset=0
for q,data in files.items():
 e=entry(q);e.update(size=len(data),offset=str(offset));e.pop('unpacked',None);e['integrity']={'algorithm':'SHA256','hash':hashlib.sha256(data).hexdigest(),'blockSize':4194304,'blocks':[hashlib.sha256(data[i:i+4194304]).hexdigest() for i in range(0,len(data),4194304)]};offset+=len(data)
h=json.dumps(header,separators=(',',':'),ensure_ascii=False).encode();pad=(-len(h))%4;pickle_size=8+len(h)+pad
out=pathlib.Path('work/monday-updated.asar')
with out.open('wb') as w:
 w.write(struct.pack('<4I',4,pickle_size,4+len(h)+pad,len(h)));w.write(h);w.write(b'\0'*pad)
 for data in files.values():w.write(data)
pathlib.Path('work/asar-header.sha256').write_text(hashlib.sha256(h).hexdigest())
# Verify all packed bytes and hashes, including newly imported media.
with out.open('rb') as r:
 nums=struct.unpack('<4I',r.read(16));assert json.loads(r.read(nums[3]))==header
 b=8+nums[1]
 for q,data in files.items():
  e=entry(q);r.seek(b+int(e['offset']));assert r.read(e['size'])==data,q
print('Verified archive:',len(files),'packed files;',out.stat().st_size,'bytes')

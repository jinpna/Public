from pathlib import Path
import shutil,plistlib,subprocess,hashlib
app=Path('/Applications/Monday MUSE AI.app');backup=Path('work/backup-before-mopix/Monday MUSE AI.bundle-backup')
if not backup.exists():shutil.copytree(app,backup,symlinks=True)
asar=app/'Contents/Resources/app.asar';stage=asar.with_suffix('.asar.mopix-staged');shutil.copy2('work/monday-updated.asar',stage);stage.replace(asar)
shutil.copy2('work/mopix.icns',app/'Contents/Resources/icon.icns')
p=app/'Contents/Info.plist';d=plistlib.loads(p.read_bytes());d['ElectronAsarIntegrity']['Resources/app.asar']['hash']=Path('work/asar-header.sha256').read_text().strip();p.write_bytes(plistlib.dumps(d,fmt=plistlib.FMT_XML,sort_keys=False))
subprocess.run(['/usr/bin/codesign','--force','--deep','--sign','-',str(app)],check=True)
subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',str(app)],check=True)
assert hashlib.sha256(asar.read_bytes()).digest()==hashlib.sha256(Path('work/monday-updated.asar').read_bytes()).digest()
print('Installed MOPIX interface, icon and native 4K service; full pre-update app backup retained.')

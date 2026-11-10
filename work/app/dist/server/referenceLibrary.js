'use strict';const {db}=require('./db'),{broadcast}=require('./ws');
for(const col of ["category TEXT",'archived_at TEXT','internal_only INTEGER NOT NULL DEFAULT 0'])try{db.exec('ALTER TABLE ref_images ADD COLUMN '+col)}catch{}
db.prepare("UPDATE ref_images SET internal_only=1 WHERE tag LIKE 'space_input_%'").run();
function listRefs({archived=false,internal=false}={}){return db.prepare('SELECT * FROM ref_images WHERE '+(archived?'archived_at IS NOT NULL':'archived_at IS NULL')+(internal?'':' AND internal_only=0')+' ORDER BY created_at DESC').all().map(r=>({...r,url:'/uploads/'+r.filename,file_url:'/api/refs/'+encodeURIComponent(r.tag)+'/file'}))}
function publishRefs(){broadcast('REFS_UPDATED',listRefs())}
module.exports={listRefs,publishRefs};

'use strict';
const {db}=require('./db'),{DATA_DIR}=require('./paths'),{createImageTrash}=require('./imageTrash.cjs');
const service=createImageTrash({db,dataDir:DATA_DIR});
let timer;function start(){if(timer)return;const sweep=()=>{try{const result=service.clean({expiredOnly:true});if(result.failed.length)console.warn('[Image trash] Some expired images could not be removed; retrying next minute.')}catch(error){console.warn('[Image trash] Cleanup pending:',error.message)}};setImmediate(sweep);timer=setInterval(sweep,60000);timer.unref();}
module.exports={...service,start};

'use strict';const router=require('express').Router();router.use((_req,res)=>res.status(410).json({error:'Tính năng tách nền đã được gỡ khỏi Monday.Directory'}));module.exports=router;

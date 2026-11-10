"use strict";
Object.defineProperty(exports,"__esModule",{value:true});
const router=require("express").Router();
router.get("/",(_req,res)=>res.json({success:true,zaloCommunity:"",zaloPersonal:"",telegram:"",announcement:"Bản quyền thuộc về Monday.directory",latestVersion:"1.0.0",updateUrl:"",source:"local"}));
exports.default=router;

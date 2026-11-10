const IMAGE_TIMEOUT_MS=180000,IMAGE_CONCURRENCY=3,IMAGE_MAX_TIMEOUT_RETRIES=2;
function imageStartedAt(job){if(!job.started_at)return null;const raw=String(job.started_at),time=Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(raw)?raw:raw.replace(' ','T')+'Z');return Number.isFinite(time)?time:null}
function imageExpired(job,now=Date.now()){const start=imageStartedAt(job);return job.media_type==='image'&&job.status==='running'&&start!==null&&now-start>=IMAGE_TIMEOUT_MS}
function canAssign(job,account,{runningImages=0,slots=1}={}){return account.jobs_running===0&&(job.media_type!=='image'||runningImages<IMAGE_CONCURRENCY)}
// museWorker.runJob throws this for an image that produced no result in time. Only this message
// (and the dispatcher's own timer) counts as a timeout; auth/validation/policy errors never do.
function isImageTimeoutMessage(message){return String(message||'').includes('Muse không trả ảnh trong thời gian cho phép')}
// Pure: after an image attempt timed out, retry or finish? `used` = timeout retries already consumed (jobs.attempts).
function imageTimeoutDecision(used){const n=Math.max(0,Number(used)||0);return n<IMAGE_MAX_TIMEOUT_RETRIES?{action:'retry',attempts:n+1,maxRetries:IMAGE_MAX_TIMEOUT_RETRIES}:{action:'fail',attempts:n,maxRetries:IMAGE_MAX_TIMEOUT_RETRIES}}
// Pure: a timer/watchdog firing may act only on the attempt it was armed for, once.
function attemptOwns(entry,token){return !!entry&&entry.token===token&&!entry.expired&&!entry.finished}
// Pure: a pending job may start only when no previous attempt for it is still unwinding.
function canStartAttempt(entry){return !entry}
module.exports={IMAGE_TIMEOUT_MS,IMAGE_CONCURRENCY,IMAGE_MAX_TIMEOUT_RETRIES,imageStartedAt,imageExpired,canAssign,isImageTimeoutMessage,imageTimeoutDecision,attemptOwns,canStartAttempt};

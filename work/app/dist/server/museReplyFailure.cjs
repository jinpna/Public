'use strict';
function imageReplyFailure(reply){const text=String(reply||'').trim();if(!text)return null;
 if(/không thể hỗ trợ|chính sách|vi phạm|không phù hợp|không được phép|content policy|safety policy|cannot (help|create|make)|can't (help|create|make)/i.test(text))return 'PROMPT_POLICY_ERROR: '+text.slice(0,1200);
 if(/(?:vẫn |chưa |không |chẳng )(?:thể )?(?:tạo|làm|xử lý|thực hiện)(?:.{0,70}?)(?:được|yêu cầu)|không tạo được|cannot generate|unable to generate|could not generate/i.test(text))return 'MUSE_NEEDS_REVISION: '+text.slice(0,1200);
 return null;
}
module.exports={imageReplyFailure};

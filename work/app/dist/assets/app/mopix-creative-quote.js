export const CREATIVE_QUOTES=[
 'Bắt đầu từ một nét.',
 'Cho ý tưởng một hình hài.',
 'Đơn giản để khác biệt.',
 'Thử một góc nhìn mới.',
 'Để trí tưởng tượng dẫn lối.',
 'Một chi tiết. Một khác biệt.',
 'Tạo điều bạn muốn thấy.',
 'Ít hơn, rõ hơn.',
 'Biến cảm hứng thành hình.',
 'Mỗi nét đều có lý do.',
 'Ý tưởng nhỏ. Khả năng lớn.',
 'Tìm cái đẹp trong điều quen.',
 'Dám thử một điều mới.',
 'Không ngừng nhìn khác đi.',
 'Để khoảng trống lên tiếng.',
 'Một màu sắc. Nhiều cảm xúc.',
 'Chạm vào điều chưa có.',
 'Thiết kế từ sự tò mò.',
 'Thêm một chút bất ngờ.',
 'Hôm nay, tạo điều mới.'
];
export function createCreativeQuote(React){
 const{createElement:h,useState:S,useEffect:E}=React;
 return function CreativeQuote(){
  const[index,I]=S(0);
  E(()=>{const timer=setInterval(()=>{if(!document.hidden)I(i=>(i+1)%CREATIVE_QUOTES.length)},4000);return()=>clearInterval(timer)},[]);
  return h('h1',{className:'mopix-creative-quote'},h('span',{key:index},CREATIVE_QUOTES[index]));
 };
}

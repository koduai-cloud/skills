import {readFile,stat} from 'node:fs/promises';
export const ticketCommands=['ticket-create','tickets','ticket'];
export async function runTicketCommand(command,o,{call}) {
 if(command==='tickets') {const page=o.page===undefined?1:Number(o.page);if(!Number.isSafeInteger(page)||page<1||page>100000)throw new Error('工单页码无效');return call('list_tickets',{search:typeof o.search==='string'?o.search:'',page});}
 if(command==='ticket') {
  if(typeof o.ticket!=='string'||!/^tkt-[a-z0-9]{16}$/.test(o.ticket))throw new Error('请指定正确 --ticket');
  return call('ticket_detail',{uid:o.ticket});
 }
 if(command==='ticket-create') {
  if(typeof o.title!=='string'||typeof o['content-file']!=='string')throw new Error('请指定 --title 和 --content-file，只提交用户授权的问题说明');
  if((await stat(o['content-file'])).size>40000)throw new Error('工单内容不能超过10000字');
  const content=(await readFile(o['content-file'],'utf8')).trim(),title=o.title.trim(),category=o.category||'general',priority=o.priority||'normal';
  if([...title].length<3||[...title].length>120||[...content].length<5||[...content].length>10000||content.includes('\0')||!['general','deployment','billing','account'].includes(category)||!['normal','high','urgent'].includes(priority))throw new Error('工单标题、内容、分类或优先级无效');
  return call('create_ticket',{title,content,category,priority});
 }
 throw new Error('未知工单命令');
}

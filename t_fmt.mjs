
import { toWhatsApp, splitText, command } from './api/whatsapp.js';
const md = "# Patience\n\nThis is **bold** and *italic* and ***both***.\n\n## Steps\n- one\n- two with `code`\n* three\n\n[Blossom](https://x.com) ~~old~~\n\n```js\nconst a = 2*3*4;\n```\n---\nEnd **Note:** done";
console.log(toWhatsApp(md));
console.log(splitText('a'.repeat(3000)+'\n\n'+'b'.repeat(3000)).map(x=>x.length));
const st={history:[{role:'user',text:'hi'}],memory:[]};
for (const t of ['remember that my wife is Tola','Remember I prefer British spelling','/memory','/forget 1','/forget 9','/new','hello']) console.log(t,'=>',JSON.stringify(command(t,st)));
console.log(st);

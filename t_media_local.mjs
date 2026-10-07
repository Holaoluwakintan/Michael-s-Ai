
import fs from 'node:fs';
import * as M from './api/_media.js';
const v={buf:fs.readFileSync('/tmp/mt/clip.mp4'),mime:'video/mp4'}, im={buf:fs.readFileSync('/tmp/mt/img.png'),mime:'image/png'}, au={buf:fs.readFileSync('/tmp/mt/a.mp3'),mime:'audio/mpeg'};
for (const t of ['trim 0:02-0:05','trim first 3 sec','compress','caption Sunday service 9am at Blossom Hall, come early!','extract audio','make video','trim 5-2']) {
  const c=M.parseMediaCmd(t); const t0=Date.now();
  if (!c || c.op==='bad') { console.log(t, JSON.stringify(c)); continue; }
  const r=await M.process1(c,{video:v,image:im,audio:au});
  console.log(t, r.ok, r.ok? M.doneCaption(c,r).replace(/\n/g,' ') : r.error, Date.now()-t0,'ms');
  if (r.ok) fs.writeFileSync('/tmp/mt/out-'+c.op+(r.mime==='audio/mpeg'?'.mp3':'.mp4'), r.buf);
}

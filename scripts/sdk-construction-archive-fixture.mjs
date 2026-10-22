// Small real ZIP/USTAR/OCI byte fixtures. They contain no SDK/application and
// cannot establish provider, native execution, filesystem or VV acceptance.
import {createHash} from 'node:crypto';
import {crc32,gzipSync} from 'node:zlib';
export const sha=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
export const json=v=>Buffer.from(JSON.stringify(v));
export function tarEntry(name,data=Buffer.alloc(0),type='0'){
 const h=Buffer.alloc(512);h.write(name,0,100);h.write('0000444\0',100);h.write('0000000\0',108);h.write('0000000\0',116);
 h.write(data.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.fill(32,148,156);
 h.write(type,156);h.write('ustar\0'+'00',257);
 const sum=h.reduce((n,x)=>n+x,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
 return Buffer.concat([h,data,Buffer.alloc((512-data.length%512)%512)]);
}
export function storedZip(files,wide=false){
 const pieces=[],directory=[],rows=[];let offset=0;
 for(const [name,b]of files){
  const nb=Buffer.from(name),crc=crc32(b),h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(8,6);h.writeUInt16LE(nb.length,26);
  const d=Buffer.alloc(16);d.writeUInt32LE(0x08074b50);d.writeUInt32LE(crc,4);d.writeUInt32LE(b.length,8);d.writeUInt32LE(b.length,12);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x0314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,8);
  c.writeUInt32LE(crc,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(nb.length,28);
  c.writeUInt32LE((0o100444<<16)>>>0,38);c.writeUInt32LE(offset,42);
  rows.push({name,local:offset,data:offset+30+nb.length,length:b.length});pieces.push(h,nb,b,d);directory.push(c,nb);offset+=h.length+nb.length+b.length+d.length;
 }
 const size=directory.reduce((n,b)=>n+b.length,0),central=offset;pieces.push(...directory);
 if(wide){const z=Buffer.alloc(56),l=Buffer.alloc(20);z.writeUInt32LE(0x06064b50);z.writeBigUInt64LE(44n,4);z.writeUInt16LE(45,12);z.writeUInt16LE(45,14);
  z.writeBigUInt64LE(BigInt(files.size),24);z.writeBigUInt64LE(BigInt(files.size),32);z.writeBigUInt64LE(BigInt(size),40);z.writeBigUInt64LE(BigInt(offset),48);
  l.writeUInt32LE(0x07064b50);l.writeBigUInt64LE(BigInt(offset+size),8);l.writeUInt32LE(1,16);pieces.push(z,l);}
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.size,8);end.writeUInt16LE(files.size,10);end.writeUInt32LE(size,12);end.writeUInt32LE(wide?0xffffffff:offset,16);pieces.push(end);
 return {bytes:Buffer.concat(pieces),rows,central};
}
export function fixture({entries=values=>values,tar=values=>values,wide=false,zip=()=>{},indexPadding=0}={}){
 const layer=gzipSync(Buffer.alloc(1024)),config=json({architecture:'amd64',os:'linux',rootfs:{type:'layers',diff_ids:[sha(Buffer.alloc(1024))]}});
 const manifest=json({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',
  config:{mediaType:'application/vnd.oci.image.config.v1+json',digest:sha(config),size:config.length},
  layers:[{mediaType:'application/vnd.oci.image.layer.v1.tar+gzip',digest:sha(layer),size:layer.length}]});
 const index=Buffer.concat([json({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:[{
  mediaType:'application/vnd.oci.image.manifest.v1+json',digest:sha(manifest),size:manifest.length,platform:{os:'linux',architecture:'amd64'}}]}),Buffer.alloc(indexPadding,32)]);
 const tarEntries=entries([{name:'blobs/',type:'5'},{name:'blobs/sha256/',type:'5'},
  ...[layer,config,manifest].map(data=>({name:'blobs/sha256/'+sha(data).slice(7),data})),
  {name:'index.json',data:index},{name:'oci-layout',data:json({imageLayoutVersion:'1.0.0'})}]);
 const archive=tar(Buffer.concat([...tarEntries.map(r=>tarEntry(r.name,r.data,r.type)),Buffer.alloc(1024)]));
 const members=new Map(['authority-result.json','candidate.json','cli.json','config.json','digest.txt','inventory.json','manifest.json',
  'model-check.json','standards.lock','tamper.json'].map(name=>['evidence/'+name,name==='manifest.json'?manifest:name==='config.json'?config:json({unit_only:true})]));
 const archiveDescriptor={byte_length:archive.length,digest:sha(archive)};
 const record={archive:{path:'sdk.oci.tar',...archiveDescriptor},manifest:{digest:sha(manifest),byte_length:manifest.length},
  smoke_evidence:[...members].map(([path,b])=>({path,byte_length:b.length,digest:sha(b)}))};
 members.set('construction.json',json(record));
 const zipped=storedZip(new Map([...members,['sdk.oci.tar',archive]]),wide);zip(zipped);
 return {...zipped,archive,plan:{artifact:{byte_length:zipped.bytes.length,digest:sha(zipped.bytes)},archive:archiveDescriptor,members}};
}

// Sparse pixel/palette edits and stroke-level local undo, shared by UI/tests.
export class BitmapDraft {
  constructor(bitmap, edits=new Map()) { this.bitmap=bitmap;this.edits=edits;this.undo=[];this.redo=[];this.stroke=null; }
  original(kind,index) { const b=this.bitmap;return kind==='palette'?b.palette[index]:b.bits===8?b.pixels[index]:Array.from(b.pixels.subarray(index*b.channels,(index+1)*b.channels)); }
  value(kind,index) { return this.edits.get(`bmp/${kind}/${index}`)??this.original(kind,index); }
  apply(kind,index,value) { const key=`bmp/${kind}/${index}`;if(JSON.stringify(value)===JSON.stringify(this.original(kind,index)))this.edits.delete(key);else this.edits.set(key,Array.isArray(value)?[...value]:value); }
  begin() { this.stroke=new Map(); }
  set(kind,index,value) { const before=this.value(kind,index);if(JSON.stringify(before)===JSON.stringify(value))return;const key=`${kind}/${index}`;if(!this.stroke.has(key))this.stroke.set(key,{kind,index,before});this.apply(kind,index,value); }
  end() { const record=[...(this.stroke?.values()??[])].map(item=>({...item,after:this.value(item.kind,item.index)})).filter(item=>JSON.stringify(item.before)!==JSON.stringify(item.after));this.stroke=null;if(record.length){this.undo.push(record);this.redo=[];} }
  step(forward=false) { const from=forward?this.redo:this.undo,to=forward?this.undo:this.redo,record=from.pop();if(!record)return;for(const item of record)this.apply(item.kind,item.index,forward?item.after:item.before);to.push(record); }
  changes() { const result={pixels:[],palette:[]};for(const [key,value]of this.edits){const match=/^bmp\/(pixel|palette)\/(\d+)$/.exec(key);if(match)result[match[1]==='pixel'?'pixels':'palette'].push(match[1]==='pixel'?{index:Number(match[2]),value}:{index:Number(match[2]),color:value});}return result; }
  rgba(mode='opaque') {
    const b=this.bitmap,out=new Uint8ClampedArray(b.width*b.height*4),pixels=b.pixels.slice(),palette=b.palette.map((_,i)=>this.value('palette',i)),key=palette[0];
    for(const [name,value]of this.edits){const match=/^bmp\/pixel\/(\d+)$/.exec(name);if(match){const index=Number(match[1]);if(b.bits===8)pixels[index]=value;else pixels.set(value,index*b.channels);}}
    for(let index=0;index<b.width*b.height;index++){
      const at=index*b.channels,to=index*4,color=b.bits===8?palette[pixels[index]]:null,r=color?color[0]:pixels[at],g=color?color[1]:pixels[at+1],blue=color?color[2]:pixels[at+2];
      out[to]=r;out[to+1]=g;out[to+2]=blue;out[to+3]=mode==='alpha'&&b.bits===32?pixels[at+3]:mode==='key'&&key&&key[0]===r&&key[1]===g&&key[2]===blue?0:255;
    }
    return out;
  }
}

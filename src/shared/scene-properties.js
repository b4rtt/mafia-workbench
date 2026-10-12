// Group by chunk identity, not by displayed name: two frames may share a name.
// Nested light/sound/parent chunks belong to their containing scene object.
export function groupSceneProperties(file) {
  const objects=new Map((file.objects??[]).map(object=>[object.id,object])),groups=new Map();
  const canonical=name=>name.normalize('NFC').toLowerCase(),byName=new Map(),actorFrames=new Map();
  for(const object of file.objects??[]){const name=canonical(object.name);byName.set(name,byName.has(name)?null:object);}
  // AE23 is a frame reference. Attach actor settings only to a unique match.
  for(const entry of file.entries.filter(e=>e.label==='Název aktéra'&&typeof e.value==='string')){
    const object=byName.get(canonical(entry.value));if(object)actorFrames.set(entry.id.slice(0,entry.id.lastIndexOf('/')),object);
  }
  for(const entry of file.entries){
    const parent=entry.id.slice(0,entry.id.lastIndexOf('/'));
    let ancestor=parent,object;
    while(ancestor){if(objects.has(ancestor)){object=objects.get(ancestor);break;}const separator=ancestor.lastIndexOf('/');ancestor=separator<0?'':ancestor.slice(0,separator);}
    const actor=actorFrames.get(parent);object??=actor;
    const standaloneScript=entry.kind==='script'&&!entry.actorScript;
    const id=object?`object/${object.id}`:standaloneScript?`script/${entry.id}`:`chunk/${parent}`;
    const name=object?.name??(entry.kind==='script'?entry.value.name:entry.context.split(' / ').at(-1));
    if(!groups.has(id))groups.set(id,{id,name,context:entry.context,entries:[]});
    const group=groups.get(id),parts=entry.context.split(' / '),index=object?parts.lastIndexOf(object.name):parts.length-1;
    const nested=index>=0?parts.slice(index+1):parts;
    group.entries.push({entry,label:actor?`Aktér · ${entry.label}`:[...nested,entry.label].join(' · ')});
  }
  return [...groups.values()];
}

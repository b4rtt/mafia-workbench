import test from 'node:test';
import assert from 'node:assert/strict';
import {groupSceneProperties} from '../src/shared/scene-properties.js';
test('scene properties keep same-name objects separate and include nested sound and parent fields',()=>{
  const objects=[{id:'0/1/1',name:'ptaci1'},{id:'0/1/10',name:'ptaci1'}];
  const entries=[
    {id:'0/1/1/0',context:'Scéna / Objekty / ptaci1',label:'Název',value:'ptaci1'},
    {id:'0/1/1/1',context:'Scéna / Objekty / ptaci1',label:'Pozice',value:[0,0,0]},
    {id:'0/1/1/2/0',context:'Scéna / Objekty / ptaci1 / Rodič / Primary sector',label:'Název',value:'Primary sector'},
    {id:'0/1/1/3/0',context:'Scéna / Objekty / ptaci1 / Zvuk / 2_bird.wav',label:'Hlasitost',value:1},
    {id:'0/1/10/0',context:'Scéna / Objekty / ptaci1',label:'Pozice',value:[10,0,0]}
  ];
  const groups=groupSceneProperties({objects,entries});
  assert.equal(groups.length,2);assert.equal(groups[0].name,'ptaci1');assert.notEqual(groups[0].id,groups[1].id);
  assert.deepEqual(groups[0].entries.map(item=>item.label),['Název','Pozice','Rodič · Primary sector · Název','Zvuk · 2_bird.wav · Hlasitost']);
  assert.deepEqual(groups.flatMap(group=>group.entries.map(item=>item.entry)),entries);
});
test('actor source belongs to its actor while standalone scripts remain individually selectable',()=>{
  const entries=[
    {id:'0/7/1/2',context:'Scéna / Aktéři / root',kind:'script',actorScript:true,label:'Skript aktéra',value:{name:'root',code:'wait 1'}},
    {id:'0/7/1/0',context:'Scéna / Aktéři / root',kind:'uint',label:'Typ aktéra',value:5},
    {id:'0/7/1/1',context:'Scéna / Aktéři / root',kind:'string',label:'Název aktéra',value:'root'},
    {id:'0/8/0',context:'Scéna / Skripty',kind:'script',label:'Skript',value:{name:'One',code:''}},
    {id:'0/8/1',context:'Scéna / Skripty',kind:'script',label:'Skript',value:{name:'Two',code:''}}
  ];
  const groups=groupSceneProperties({entries});assert.deepEqual(groups.map(group=>group.name),['root','One','Two']);assert.equal(groups[0].entries.length,3);
  assert.deepEqual(groups.flatMap(group=>group.entries.map(item=>item.entry)),entries);
});
test('actor frame references join a unique object with its script, but ambiguous names stay separate',()=>{
  const objects=[{id:'0/1/0',name:'Start'},{id:'0/1/1',name:'duplicate'},{id:'0/1/2',name:'DUPLICATE'}];
  const entries=[
    {id:'0/1/0/0',context:'Scéna / Objekty / Start',label:'Pozice',value:[0,0,0]},
    {id:'0/7/0/0',context:'Scéna / Aktéři / start',label:'Název aktéra',value:'start'},
    {id:'0/7/0/2',context:'Scéna / Aktéři / start',kind:'script',actorScript:true,label:'Skript aktéra',value:{name:'start',code:''}},
    {id:'0/1/1/0',context:'Scéna / Objekty / duplicate',label:'Pozice',value:[0,0,0]},
    {id:'0/1/2/0',context:'Scéna / Objekty / DUPLICATE',label:'Pozice',value:[0,0,0]},
    {id:'0/7/1/0',context:'Scéna / Aktéři / duplicate',label:'Název aktéra',value:'duplicate'}
  ];
  const groups=groupSceneProperties({objects,entries});assert.equal(groups.length,4);
  assert.deepEqual(groups[0].entries.map(item=>item.label),['Pozice','Aktér · Název aktéra','Aktér · Skript aktéra']);
  assert.deepEqual(groups.flatMap(group=>group.entries.map(item=>item.entry)),entries);
});

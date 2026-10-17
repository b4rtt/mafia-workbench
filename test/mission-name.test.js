import test from 'node:test';
import assert from 'node:assert/strict';
import {missionName} from '../src/core/mission.js';
import {missionNamePattern} from '../src/shared/mission-name.js';

test('HTML Unicode-set pattern and host agree on safe mission folder names',()=>{
  const browser=new RegExp('^(?:'+missionNamePattern+')$','v');
  for(const name of ['A','0','Mise-1','WB_CITY_02','CON-house','wbtest2','a'.repeat(48)]){
    assert(browser.test(name),name);assert.equal(missionName(name),name);
  }
  for(const name of ['', '-mise','_mise','a'.repeat(49),'a b','a/b','a\\b','a.b','Česká','a\nb','a\n','CON','con','CoN','PrN','AUX','nul','COM1','cOm9','LPT1','lpt9','WBTEST','wBtEsT']){
    assert(!browser.test(name),JSON.stringify(name));assert.throws(()=>missionName(name));
  }
});

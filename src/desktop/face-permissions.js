export function facePermissionGate(now=Date.now) {
  let until=0;
  const active=()=>now()<until;
  const local=origin=>origin==='workbench://app'||origin==='workbench://app/';
  return {arm(){until=now()+30000;},clear(){until=0;},check(permission,origin,details){return active()&&permission==='media'&&local(origin)&&details.isMainFrame===true&&details.mediaType==='video'&&details.requestingUrl==='workbench://app/index.html';},request(permission,details){const types=details.mediaTypes;return active()&&permission==='media'&&details.isMainFrame===true&&details.requestingUrl==='workbench://app/index.html'&&local(details.securityOrigin)&&Array.isArray(types)&&types.length===1&&types[0]==='video';}};
}

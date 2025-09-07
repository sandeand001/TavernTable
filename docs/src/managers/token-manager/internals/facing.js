function getFacingButtonPort(c){
    if(c?.domPorts?.getFacingButton)return c.domPorts.getFacingButton();
    if(typeof document==='undefined')return null;
    return document.querySelector('[data-facing-button]');
}
export function toggleFacing(c){
    c.tokenFacingRight=!c.tokenFacingRight;
    const btn=getFacingButtonPort(c);
    if(btn) btn.textContent=c.tokenFacingRight?'➡️ Right':'⬅️ Left';
}

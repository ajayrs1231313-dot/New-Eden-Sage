import { useEffect, useRef, useState } from "react";

function localDateTimeValue(date=new Date()){
  const pad=(value:number)=>String(value).padStart(2,"0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function SystemClock(){
  const [now,setNow]=useState(()=>new Date());
  const [menu,setMenu]=useState(false);
  const [manual,setManual]=useState(false);
  const [manualValue,setManualValue]=useState(()=>localDateTimeValue());
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [platform,setPlatform]=useState("");
  const root=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),1000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{void window.sage.getHostClock().then(value=>setPlatform(`${value.platform} · ${value.timezone}`)).catch(()=>undefined);},[]);
  useEffect(()=>{if(!menu)return;const close=(event:MouseEvent)=>{if(root.current&&!root.current.contains(event.target as Node))setMenu(false);};window.addEventListener("mousedown",close);return()=>window.removeEventListener("mousedown",close);},[menu]);
  async function sync(){setBusy(true);setMessage("");try{const value=await window.sage.syncHostClock();setMessage(value.ok?"":value.message);setNow(new Date());}catch(error){setMessage(error instanceof Error?error.message:"Clock sync failed.");}finally{setBusy(false);}}
  async function applyManual(){setBusy(true);setMessage("");try{await window.sage.setHostClock(manualValue);setMessage("");setNow(new Date());setManual(false);setMenu(false);}catch(error){setMessage(error instanceof Error?error.message:"Could not set host clock.");}finally{setBusy(false);}}
  const time=now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  return <div className="system-clock" ref={root} title={`${platform || "Host OS clock"}${message?` · ${message}`:""}`}>
    <button type="button" className="system-clock-face" onContextMenu={(event)=>{event.preventDefault();setMenu(true);setManual(false);setManualValue(localDateTimeValue());}}>{time}</button>
    {menu&&<div className="system-clock-menu" role="menu">
      {!manual?<>
        <button type="button" disabled={busy} onClick={()=>void sync()}>Sync time</button>
        <button type="button" disabled={busy} onClick={()=>{setManual(true);setManualValue(localDateTimeValue());}}>Manually set time</button>
        {message&&<small>{message}</small>}
      </>:<>
        <strong>Manual host time</strong>
        <input type="datetime-local" step="1" value={manualValue} onChange={event=>setManualValue(event.target.value)} />
        <div><button type="button" disabled={busy} onClick={()=>void applyManual()}>Set time</button><button type="button" onClick={()=>setManual(false)}>Back</button></div>
        <small>Changing system time may request administrator approval from the OS.</small>
      </>}
    </div>}
  </div>;
}

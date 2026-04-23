import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG — edit config.js (gitignored) to set your values ─────────────────
import { API_URL, API_TOKEN } from "./config.js";
// ─────────────────────────────────────────────────────────────────────────────

const API_HEADERS = {
  "Content-Type": "application/json",
  "X-Token": API_TOKEN,
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const DAY_NAMES        = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const HOURS_12         = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES          = ["00","05","10","15","20","25","30","35","40","45","50","55"];
const INTERVAL_OPTIONS = [1,2,5,10,15,20,30,45,60];
const ORDINALS         = ["1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th",
  "11th","12th","13th","14th","15th","16th","17th","18th","19th","20th",
  "21st","22nd","23rd","24th","25th","26th","27th","28th","29th","30th","31st"];

// ─── CRON PARSER ──────────────────────────────────────────────────────────────

function parseCron(expr) {
  if (!expr) return "Unknown schedule";
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, month, dow] = parts;

  if (min.startsWith("*/") && hour==="*" && dom==="*" && month==="*" && dow==="*") {
    const n = parseInt(min.slice(2));
    return n === 1 ? "Every minute" : "Every " + n + " minutes";
  }
  if (hour==="*" && dom==="*" && month==="*" && dow==="*" && !min.startsWith("*")) {
    return "Every hour at :" + String(parseInt(min)).padStart(2,"0");
  }
  const fmtTime = (h24, m) => {
    const ampm = h24 < 12 ? "AM" : "PM";
    const h = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
    return h + ":" + String(m).padStart(2,"0") + " " + ampm;
  };
  if (dom==="*" && month==="*" && dow==="*" && !min.includes("*") && !hour.includes("*"))
    return "Daily at " + fmtTime(parseInt(hour), parseInt(min));
  if (dom==="*" && month==="*" && !dow.includes("*") && !min.includes("*") && !hour.includes("*")) {
    const days = dow.split(",").map(d => DAY_NAMES[parseInt(d)] || d).join(", ");
    return "Every " + days + " at " + fmtTime(parseInt(hour), parseInt(min));
  }
  if (!dom.includes("*") && month==="*" && dow==="*" && !min.includes("*") && !hour.includes("*"))
    return "Monthly on the " + (ORDINALS[parseInt(dom)-1] || dom) + " at " + fmtTime(parseInt(hour), parseInt(min));
  return expr;
}

// ─── CRON BUILDER ─────────────────────────────────────────────────────────────

function buildCron(state) {
  const { freq, interval, atMinute, hour, minute, ampm, days, dom } = state;
  const h24 = ampm === "AM"
    ? (hour === 12 ? 0 : parseInt(hour))
    : (hour === 12 ? 12 : parseInt(hour) + 12);
  const m = parseInt(minute ?? atMinute ?? "0");
  switch (freq) {
    case "minutes": return "*/" + interval + " * * * *";
    case "hourly":  return atMinute + " * * * *";
    case "daily":   return m + " " + h24 + " * * *";
    case "weekly":  return m + " " + h24 + " * * " + ((days||[]).sort().join(",")||"0");
    case "monthly": return m + " " + h24 + " " + dom + " * *";
    default:        return "* * * * *";
  }
}

// ─── CRON → STATE ─────────────────────────────────────────────────────────────

function cronToState(expr) {
  if (!expr) return defaultPickerState();
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return defaultPickerState();
  const [min, hour, dom, month, dow] = parts;
  const toAmPm = (h24) => ({ hour: h24===0?12:h24>12?h24-12:h24, ampm: parseInt(h24)<12?"AM":"PM" });
  const snap   = (m) => String(Math.round(m/5)*5).padStart(2,"0");
  if (min.startsWith("*/") && hour==="*" && dom==="*" && month==="*" && dow==="*")
    return { freq:"minutes", interval:parseInt(min.slice(2)), atMinute:"0", hour:12, minute:"00", ampm:"AM", days:[], dom:1 };
  if (hour==="*" && dom==="*" && month==="*" && dow==="*" && !min.startsWith("*"))
    return { freq:"hourly", interval:30, atMinute:String(parseInt(min)).padStart(2,"0"), hour:12, minute:"00", ampm:"AM", days:[], dom:1 };
  if (dom==="*" && month==="*" && dow==="*" && !min.includes("*") && !hour.includes("*")) {
    const { hour:h, ampm } = toAmPm(parseInt(hour));
    return { freq:"daily", interval:30, atMinute:"0", hour:h, minute:snap(parseInt(min)), ampm, days:[], dom:1 };
  }
  if (dom==="*" && month==="*" && !dow.includes("*") && !min.includes("*") && !hour.includes("*")) {
    const { hour:h, ampm } = toAmPm(parseInt(hour));
    return { freq:"weekly", interval:30, atMinute:"0", hour:h, minute:snap(parseInt(min)), ampm, days:dow.split(",").map(Number), dom:1 };
  }
  if (!dom.includes("*") && month==="*" && dow==="*" && !min.includes("*") && !hour.includes("*")) {
    const { hour:h, ampm } = toAmPm(parseInt(hour));
    return { freq:"monthly", interval:30, atMinute:"0", hour:h, minute:snap(parseInt(min)), ampm, days:[], dom:parseInt(dom) };
  }
  return defaultPickerState();
}

function defaultPickerState() {
  return { freq:"daily", interval:30, atMinute:"0", hour:12, minute:"00", ampm:"PM", days:[], dom:1 };
}

// ─── RELATIVE TIME ────────────────────────────────────────────────────────────

function relativeTime(isoString) {
  if (!isoString) return null;
  const diff = new Date(isoString).getTime() - Date.now();
  const abs  = Math.abs(diff);
  const mins  = Math.floor(abs/60000), hours = Math.floor(abs/3600000), days = Math.floor(abs/86400000);
  const label = abs<60000?"just now":mins<60?mins+"m":hours<24?hours+"h":days+"d";
  return diff > 0 ? "in "+label : label+" ago";
}

// ─── STATUS ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  active: { label:"ACTIVE", color:"#22c55e", pulse:true  },
  paused: { label:"PAUSED", color:"#f59e0b", pulse:false },
};

// ─── SHARED STYLES ────────────────────────────────────────────────────────────

const selectStyle = {
  background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)",
  borderRadius:4, color:"#e2e8f0", fontSize:11, fontFamily:"inherit",
  padding:"3px 6px", cursor:"pointer", outline:"none",
};

const btnStyle = (color, disabled=false) => ({
  fontSize:10, fontWeight:800, padding:"3px 10px", borderRadius:4,
  border:"1px solid "+(disabled?"#374151":color+"55"),
  background:disabled?"rgba(255,255,255,0.02)":color+"18",
  color:disabled?"#374151":color,
  cursor:disabled?"not-allowed":"pointer", letterSpacing:0.5,
});

// ─── SCHEDULE PICKER ──────────────────────────────────────────────────────────

function SchedulePicker({ cronExpression, onSave, onCancel }) {
  const [state, setState] = useState(() => cronToState(cronExpression));
  const set = (key, val) => setState(prev => ({ ...prev, [key]: val }));
  const cron = buildCron(state), preview = parseCron(cron);
  const toggleDay = (d) => setState(prev => {
    const days = prev.days.includes(d) ? prev.days.filter(x=>x!==d) : [...prev.days, d];
    return { ...prev, days };
  });
  const canSave = state.freq !== "weekly" || state.days.length > 0;

  return (
    <div style={{ background:"rgba(10,14,23,0.98)", border:"1px solid rgba(34,197,94,0.3)", borderRadius:8, padding:"14px 14px 12px", marginTop:6, boxShadow:"0 4px 24px rgba(0,0,0,0.6)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <span style={{ fontSize:10, color:"#4b5563", fontWeight:700, width:72 }}>FREQUENCY</span>
        <select value={state.freq} onChange={e=>set("freq",e.target.value)} style={{ ...selectStyle, fontWeight:700 }}>
          <option value="minutes">Every N Minutes</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      {state.freq==="minutes" && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
          <span style={{ fontSize:10, color:"#4b5563", fontWeight:700, width:72 }}>EVERY</span>
          <select value={state.interval} onChange={e=>set("interval",parseInt(e.target.value))} style={selectStyle}>
            {INTERVAL_OPTIONS.map(n=><option key={n} value={n}>{n} {n===1?"minute":"minutes"}</option>)}
          </select>
        </div>
      )}
      {state.freq==="hourly" && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
          <span style={{ fontSize:10, color:"#4b5563", fontWeight:700, width:72 }}>AT MINUTE</span>
          <select value={state.atMinute} onChange={e=>set("atMinute",e.target.value)} style={selectStyle}>
            {MINUTES.map(m=><option key={m} value={m}>:{m}</option>)}
          </select>
        </div>
      )}
      {state.freq==="weekly" && (
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:10, color:"#4b5563", fontWeight:700, marginBottom:6 }}>DAYS</div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {DAY_NAMES.map((name,i) => {
              const active = state.days.includes(i);
              return <button key={i} onClick={()=>toggleDay(i)} style={{ fontSize:10, fontWeight:800, padding:"4px 8px", borderRadius:5, border:"1px solid "+(active?"#22c55e88":"rgba(255,255,255,0.1)"), background:active?"rgba(34,197,94,0.18)":"rgba(255,255,255,0.04)", color:active?"#22c55e":"#4b5563", cursor:"pointer" }}>{name}</button>;
            })}
          </div>
          {state.days.length===0 && <div style={{ fontSize:9, color:"#ef4444", marginTop:4 }}>Select at least one day</div>}
        </div>
      )}
      {state.freq==="monthly" && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
          <span style={{ fontSize:10, color:"#4b5563", fontWeight:700, width:72 }}>DAY</span>
          <select value={state.dom} onChange={e=>set("dom",parseInt(e.target.value))} style={selectStyle}>
            {ORDINALS.map((o,i)=><option key={i} value={i+1}>{o}</option>)}
          </select>
        </div>
      )}
      {["daily","weekly","monthly"].includes(state.freq) && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
          <span style={{ fontSize:10, color:"#4b5563", fontWeight:700, width:72 }}>TIME</span>
          <select value={state.hour} onChange={e=>set("hour",parseInt(e.target.value))} style={selectStyle}>{HOURS_12.map(h=><option key={h} value={h}>{h}</option>)}</select>
          <span style={{ color:"#4b5563", fontSize:12, fontWeight:700 }}>:</span>
          <select value={state.minute} onChange={e=>set("minute",e.target.value)} style={selectStyle}>{MINUTES.map(m=><option key={m} value={m}>{m}</option>)}</select>
          <select value={state.ampm} onChange={e=>set("ampm",e.target.value)} style={selectStyle}><option value="AM">AM</option><option value="PM">PM</option></select>
        </div>
      )}
      <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", paddingTop:10, marginBottom:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:10, color:"#22c55e", fontWeight:700 }}>→</span>
          <span style={{ fontSize:11, color:"#e2e8f0", fontWeight:600 }}>{preview}</span>
          <span style={{ fontSize:9, color:"#1e293b", marginLeft:"auto", fontFamily:"monospace" }}>{cron}</span>
        </div>
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={()=>canSave&&onSave(cron)} disabled={!canSave} style={btnStyle("#22c55e",!canSave)}>✓ SAVE</button>
        <button onClick={onCancel} style={btnStyle("#94a3b8")}>✕ CANCEL</button>
      </div>
    </div>
  );
}

// ─── SCHEDULE EDITOR ──────────────────────────────────────────────────────────

function ScheduleEditor({ cronExpression, onSave }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom:open?4:8 }}>
      <div onClick={()=>setOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer" }} title="Click to change schedule">
        <span style={{ color:"#4b5563" }}>⏱</span>
        <span style={{ fontSize:11, fontWeight:600, color:"#cbd5e1", borderBottom:"1px dotted #374151" }}>{parseCron(cronExpression)}</span>
        <span style={{ fontSize:9, color:open?"#22c55e":"#374151" }}>{open?"▲":"✎"}</span>
      </div>
      {open && <SchedulePicker cronExpression={cronExpression} onSave={cron=>{onSave(cron);setOpen(false);}} onCancel={()=>setOpen(false)} />}
    </div>
  );
}

// ─── EDITABLE FIELD ───────────────────────────────────────────────────────────

function EditableField({ value, onSave, style }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);
  const inputRef              = useRef(null);
  useEffect(()=>{ if(editing&&inputRef.current) inputRef.current.focus(); },[editing]);
  const commit = () => { const t=draft.trim(); if(t&&t!==value) onSave(t); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };
  if (!editing) return (
    <span style={{ ...style, display:"inline-flex", alignItems:"center", gap:4, cursor:"text" }} onClick={()=>{setDraft(value);setEditing(true);}} title="Click to edit">
      {value}<span style={{ fontSize:9, color:"#374151", opacity:0.7 }}>✎</span>
    </span>
  );
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
      <input ref={inputRef} value={draft} onChange={e=>setDraft(e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter")commit();if(e.key==="Escape")cancel();}}
        style={{ background:"rgba(255,255,255,0.06)", border:"1px solid #22c55e55", borderRadius:4, color:"#e2e8f0", fontSize:style?.fontSize||12, fontFamily:"inherit", fontWeight:style?.fontWeight||"normal", padding:"2px 6px", outline:"none", width:200 }}
      />
      <button onClick={commit} style={btnStyle("#22c55e")}>✓</button>
      <button onClick={cancel} style={btnStyle("#ef4444")}>✕</button>
    </span>
  );
}

// ─── TOGGLE ───────────────────────────────────────────────────────────────────

function Toggle({ enabled, onChange }) {
  return (
    <div onClick={onChange} title={enabled?"Click to disable":"Click to enable"}
      style={{ width:36, height:20, borderRadius:10, cursor:"pointer", background:enabled?"#22c55e":"#374151", position:"relative", transition:"background 0.2s", flexShrink:0, border:"1px solid "+(enabled?"#16a34a":"#4b5563") }}>
      <div style={{ width:14, height:14, borderRadius:"50%", background:"#fff", position:"absolute", top:2, left:enabled?18:2, transition:"left 0.2s", boxShadow:"0 1px 3px rgba(0,0,0,0.4)" }} />
    </div>
  );
}

// ─── ADD JOB FORM ─────────────────────────────────────────────────────────────

function AddJobForm({ onSave, onCancel }) {
  const [command, setCommand]   = useState("");
  const [cronExpr, setCronExpr] = useState("0 9 * * *");
  const [pickerOpen, setPickerOpen] = useState(false);
  const canSave = command.trim().length > 0;

  return (
    <div style={{ background:"rgba(34,197,94,0.05)", border:"1px solid rgba(34,197,94,0.25)", borderRadius:10, padding:"14px", marginBottom:10 }}>
      <div style={{ fontSize:10, fontWeight:800, color:"#22c55e", letterSpacing:1, marginBottom:12 }}>+ ADD CRON JOB</div>

      {/* Command */}
      <div style={{ marginBottom:10 }}>
        <div style={{ fontSize:10, color:"#4b5563", fontWeight:700, marginBottom:4 }}>COMMAND</div>
        <input
          value={command}
          onChange={e=>setCommand(e.target.value)}
          placeholder="/path/to/script.sh"
          style={{ width:"100%", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:4, color:"#e2e8f0", fontSize:11, fontFamily:"'JetBrains Mono','Fira Code',monospace", padding:"5px 8px", outline:"none", boxSizing:"border-box" }}
        />
      </div>

      {/* Schedule */}
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:10, color:"#4b5563", fontWeight:700, marginBottom:4 }}>SCHEDULE</div>
        <div onClick={()=>setPickerOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}>
          <span style={{ color:"#4b5563" }}>⏱</span>
          <span style={{ fontSize:11, fontWeight:600, color:"#cbd5e1", borderBottom:"1px dotted #374151" }}>{parseCron(cronExpr)}</span>
          <span style={{ fontSize:9, color:pickerOpen?"#22c55e":"#374151" }}>{pickerOpen?"▲":"✎"}</span>
        </div>
        {pickerOpen && (
          <SchedulePicker
            cronExpression={cronExpr}
            onSave={cron=>{setCronExpr(cron);setPickerOpen(false);}}
            onCancel={()=>setPickerOpen(false)}
          />
        )}
      </div>

      <div style={{ display:"flex", gap:8 }}>
        <button onClick={()=>canSave&&onSave(cronExpr,command.trim())} disabled={!canSave} style={btnStyle("#22c55e",!canSave)}>✓ ADD JOB</button>
        <button onClick={onCancel} style={btnStyle("#94a3b8")}>✕ CANCEL</button>
      </div>
    </div>
  );
}

// ─── TASK CARD ────────────────────────────────────────────────────────────────

function TaskCard({ task, onToggle, onEdit, onDelete }) {
  const sc      = STATUS_CONFIG[task.enabled?"active":"paused"];
  const nextRel = relativeTime(task.nextRunAt);
  const lastRel = task.lastRunAt ? relativeTime(task.lastRunAt) : null;
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid "+(task.enabled?"rgba(255,255,255,0.09)":"rgba(255,255,255,0.04)"), borderLeft:"3px solid "+sc.color, borderRadius:10, padding:"12px 14px", opacity:task.enabled?1:0.55, transition:"opacity 0.2s" }}>

      {/* Top row */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:12, fontWeight:800, color:"#e2e8f0" }}>
            <EditableField value={task.description} onSave={val=>onEdit(task.taskId,{description:val})} style={{ fontSize:12, fontWeight:800, color:"#e2e8f0" }} />
          </div>
          <div style={{ fontSize:9, color:"#475569", marginTop:2, fontFamily:"monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{task.command}</div>
        </div>
        <div style={{ fontSize:8, fontWeight:700, padding:"2px 8px", borderRadius:10, whiteSpace:"nowrap", background:sc.color+"18", color:sc.color, border:"1px solid "+sc.color+"44", animation:sc.pulse?"pulse 2s infinite":"none" }}>
          {sc.pulse&&<span style={{ marginRight:3 }}>●</span>}{sc.label}
        </div>
        <Toggle enabled={task.enabled} onChange={()=>onToggle(task.taskId)} />
      </div>

      {/* Schedule */}
      <ScheduleEditor cronExpression={task.cronExpression} onSave={cron=>onEdit(task.taskId,{cronExpression:cron})} />

      {/* Time grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
        {[
          { label:"NEXT RUN", value:task.enabled?(nextRel||"—"):"Paused", color:task.enabled&&nextRel?.startsWith("in")?"#22c55e":"#94a3b8" },
          { label:"LAST RUN", value:lastRel, color:"#94a3b8" },
        ].map(({label,value,color})=>(
          <div key={label} style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:6, padding:"6px 8px" }}>
            <div style={{ fontSize:8, color:"#4b5563", fontWeight:700, letterSpacing:0.8, marginBottom:2 }}>{label}</div>
            <div style={{ fontSize:11, color, fontWeight:700 }}>{value||<span style={{ color:"#374151" }}>N/A</span>}</div>
          </div>
        ))}
      </div>

      {/* Delete */}
      <div style={{ display:"flex", justifyContent:"flex-end" }}>
        {confirmDelete ? (
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:10, color:"#ef4444" }}>Delete this job?</span>
            <button onClick={()=>onDelete(task.taskId)} style={btnStyle("#ef4444")}>✓ YES</button>
            <button onClick={()=>setConfirmDelete(false)} style={btnStyle("#94a3b8")}>CANCEL</button>
          </div>
        ) : (
          <button onClick={()=>setConfirmDelete(true)} style={btnStyle("#ef4444")}>🗑 DELETE</button>
        )}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function CronVisualizer() {
  const [tasks, setTasks]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [lastRefresh, setRefresh]   = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [, setTick]                 = useState(0);

  useEffect(()=>{ const iv=setInterval(()=>setTick(t=>t+1),30000); return ()=>clearInterval(iv); },[]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(API_URL+"/crons", { headers:API_HEADERS });
      if (!res.ok) throw new Error("Server returned "+res.status);
      const data = await res.json();
      setTasks(data.map(e=>({
        taskId:         String(e.index),
        index:          e.index,
        description:    e.command,
        command:        e.command,
        cronExpression: e.cronExpression,
        enabled:        e.enabled,
        nextRunAt:      null,
        lastRunAt:      null,
      })));
      setError(null);
    } catch(err) { setError(err.message); }
  }, []);

  useEffect(()=>{ fetchTasks().then(()=>setLoading(false)); },[fetchTasks]);

  const handleRefresh = useCallback(()=>{
    setRefreshing(true);
    fetchTasks().then(()=>{ setRefresh(new Date()); setRefreshing(false); });
  },[fetchTasks]);

  const handleToggle = useCallback(async (id) => {
    const task = tasks.find(t=>t.taskId===id);
    if (!task) return;
    setTasks(prev=>prev.map(t=>t.taskId===id?{...t,enabled:!t.enabled}:t));
    try {
      const res = await fetch(API_URL+"/crons/toggle",{ method:"POST", headers:API_HEADERS, body:JSON.stringify({index:task.index}) });
      if (!res.ok) throw new Error();
    } catch { setTasks(prev=>prev.map(t=>t.taskId===id?{...t,enabled:task.enabled}:t)); }
  },[tasks]);

  const handleEdit = useCallback(async (id, changes) => {
    const task = tasks.find(t=>t.taskId===id);
    if (!task) return;
    setTasks(prev=>prev.map(t=>t.taskId===id?{...t,...changes}:t));
    if (changes.cronExpression) {
      try {
        const res = await fetch(API_URL+"/crons/update",{ method:"POST", headers:API_HEADERS, body:JSON.stringify({index:task.index,cronExpression:changes.cronExpression}) });
        if (!res.ok) throw new Error();
      } catch { setTasks(prev=>prev.map(t=>t.taskId===id?{...t,cronExpression:task.cronExpression}:t)); }
    }
  },[tasks]);

  const handleDelete = useCallback(async (id) => {
    const task = tasks.find(t=>t.taskId===id);
    if (!task) return;
    setTasks(prev=>prev.filter(t=>t.taskId!==id));
    try {
      const res = await fetch(API_URL+"/crons/delete",{ method:"POST", headers:API_HEADERS, body:JSON.stringify({index:task.index}) });
      if (!res.ok) throw new Error();
      fetchTasks();
    } catch { fetchTasks(); }
  },[tasks, fetchTasks]);

  const handleAdd = useCallback(async (cronExpression, command) => {
    try {
      const res = await fetch(API_URL+"/crons/add",{ method:"POST", headers:API_HEADERS, body:JSON.stringify({cronExpression,command}) });
      if (!res.ok) throw new Error();
      setShowAddForm(false);
      fetchTasks();
    } catch(err) { alert("Failed to add job: "+err.message); }
  },[fetchTasks]);

  const activeTasks = tasks.filter(t=>t.enabled).length;
  const pausedTasks = tasks.filter(t=>!t.enabled).length;

  return (
    <div style={{ fontFamily:"'JetBrains Mono','Fira Code','Courier New',monospace", background:"#0a0e17", color:"#e2e8f0", minHeight:"100vh", padding:"12px", fontSize:12 }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, borderBottom:"1px solid rgba(34,197,94,0.25)", paddingBottom:10 }}>
        <div style={{ width:10, height:10, borderRadius:"50%", background:"#22c55e", boxShadow:"0 0 10px #22c55e", animation:"pulse 2s infinite" }} />
        <span style={{ fontSize:14, fontWeight:800, color:"#22c55e", letterSpacing:2 }}>CRON VISUALIZER</span>
        <span style={{ fontSize:9, fontWeight:700, padding:"2px 8px", borderRadius:4, background:"#22c55e22", color:"#22c55e", border:"1px solid #22c55e44" }}>{activeTasks} ACTIVE</span>
        {pausedTasks>0 && <span style={{ fontSize:9, fontWeight:700, padding:"2px 8px", borderRadius:4, background:"#f59e0b22", color:"#f59e0b", border:"1px solid #f59e0b44" }}>{pausedTasks} PAUSED</span>}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={()=>setShowAddForm(s=>!s)} style={{ fontSize:9, fontWeight:700, padding:"3px 10px", borderRadius:4, background:showAddForm?"rgba(34,197,94,0.15)":"rgba(34,197,94,0.07)", border:"1px solid rgba(34,197,94,0.3)", color:"#22c55e", cursor:"pointer", letterSpacing:0.5 }}>
            {showAddForm?"✕ CANCEL":"+ ADD JOB"}
          </button>
          <span style={{ fontSize:9, color:"#374151" }}>{new Date(lastRefresh).toLocaleTimeString()}</span>
          <button onClick={handleRefresh} disabled={refreshing} style={{ fontSize:9, fontWeight:700, padding:"3px 10px", borderRadius:4, background:refreshing?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:refreshing?"#4b5563":"#94a3b8", cursor:refreshing?"wait":"pointer", letterSpacing:0.5 }}>
            {refreshing?"⟳ REFRESHING...":"⟳ REFRESH"}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ marginBottom:14, padding:"10px 14px", borderRadius:8, background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", color:"#ef4444", fontSize:11, display:"flex", alignItems:"center", gap:8 }}>
          <span>⚠</span>
          <span>Cannot reach server — {error}</span>
          <span style={{ fontSize:9, color:"#94a3b8", marginLeft:"auto" }}>Is the SSH tunnel running? Is cron_api.py running?</span>
        </div>
      )}

      {/* Stats */}
      {!loading && !error && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:14 }}>
          {[
            { label:"Total Jobs", value:tasks.length, color:"#0ea5e9" },
            { label:"Active",     value:activeTasks,  color:"#22c55e" },
            { label:"Paused",     value:pausedTasks,  color:"#f59e0b" },
          ].map(({label,value,color})=>(
            <div key={label} style={{ background:color+"0d", border:"1px solid "+color+"22", borderRadius:8, padding:"8px 12px", textAlign:"center" }}>
              <div style={{ fontSize:20, fontWeight:800, color }}>{value}</div>
              <div style={{ fontSize:9, color:"#4b5563", fontWeight:700, letterSpacing:0.5, marginTop:2 }}>{label.toUpperCase()}</div>
            </div>
          ))}
        </div>
      )}

      {/* Add Job Form */}
      {showAddForm && <AddJobForm onSave={handleAdd} onCancel={()=>setShowAddForm(false)} />}

      {/* Task Cards */}
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {loading ? (
          <div style={{ textAlign:"center", padding:"40px 20px", color:"#374151" }}>
            <div style={{ fontSize:20, marginBottom:8, animation:"pulse 1s infinite" }}>⟳</div>
            <div style={{ fontSize:11 }}>Connecting to {API_URL}...</div>
          </div>
        ) : tasks.length===0 && !error ? (
          <div style={{ textAlign:"center", padding:"40px 20px", background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:10, color:"#374151" }}>
            <div style={{ fontSize:28, marginBottom:8 }}>📭</div>
            <div style={{ fontSize:12 }}>No cron jobs found for this user</div>
            <div style={{ fontSize:10, marginTop:4 }}>Use + ADD JOB to create one</div>
          </div>
        ) : tasks.map(task=>(
          <TaskCard key={task.taskId} task={task} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} />
        ))}
      </div>

      {/* Footer */}
      <div style={{ marginTop:14, paddingTop:10, borderTop:"1px solid rgba(255,255,255,0.05)", display:"flex", justifyContent:"space-between", fontSize:9, color:"#1e293b" }}>
        <span>CRON VISUALIZER · SPRINT 5</span>
        <span>{API_URL} · {new Date().toLocaleDateString()}</span>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        ::-webkit-scrollbar { width:4px }
        ::-webkit-scrollbar-track { background:transparent }
        ::-webkit-scrollbar-thumb { background:#1e293b; border-radius:2px }
        button:hover:not(:disabled) { filter:brightness(1.2) }
        select option { background:#0f172a }
        input::placeholder { color:#374151 }
      `}</style>
    </div>
  );
}

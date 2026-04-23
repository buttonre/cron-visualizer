import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import { API_URL, API_TOKEN } from "./config.js";

const API_HEADERS = { "Content-Type": "application/json", "X-Token": API_TOKEN };

// ─── THEME ────────────────────────────────────────────────────────────────────

const DARK = {
  bg:               "#0a0e17",
  cardBg:           "rgba(255,255,255,0.03)",
  cardBorder:       "rgba(255,255,255,0.09)",
  cardBorderOff:    "rgba(255,255,255,0.04)",
  pickerBg:         "rgba(10,14,23,0.98)",
  inputBg:          "rgba(255,255,255,0.06)",
  inputBorder:      "rgba(255,255,255,0.12)",
  selectBg:         "rgba(255,255,255,0.07)",
  selectBorder:     "rgba(255,255,255,0.12)",
  statBorder:       (c) => c + "22",
  statBg:           (c) => c + "0d",
  headerBorder:     "rgba(34,197,94,0.25)",
  text:             "#e2e8f0",
  textSub:          "#94a3b8",
  textMuted:        "#64748b",
  textDim:          "#4b5563",
  textDimmer:       "#374151",
  green:            "#22c55e",
  amber:            "#f59e0b",
  blue:             "#38bdf8",
  red:              "#ef4444",
  slate:            "#94a3b8",
  toggleOff:        "#374151",
  toggleOffBorder:  "#4b5563",
  dayBtnOff:        "rgba(255,255,255,0.04)",
  dayBtnBorderOff:  "rgba(255,255,255,0.1)",
  scrollThumb:      "#1e293b",
  footerText:       "#374151",
};

const LIGHT = {
  bg:               "#f1f5f9",
  cardBg:           "#ffffff",
  cardBorder:       "rgba(0,0,0,0.09)",
  cardBorderOff:    "rgba(0,0,0,0.04)",
  pickerBg:         "#f8fafc",
  inputBg:          "rgba(0,0,0,0.04)",
  inputBorder:      "rgba(0,0,0,0.15)",
  selectBg:         "rgba(0,0,0,0.04)",
  selectBorder:     "rgba(0,0,0,0.15)",
  statBorder:       (c) => c + "44",
  statBg:           (c) => c + "12",
  headerBorder:     "rgba(22,163,74,0.3)",
  text:             "#1e293b",
  textSub:          "#475569",
  textMuted:        "#64748b",
  textDim:          "#94a3b8",
  textDimmer:       "#cbd5e1",
  green:            "#16a34a",
  amber:            "#b45309",
  blue:             "#0369a1",
  red:              "#dc2626",
  slate:            "#64748b",
  toggleOff:        "#cbd5e1",
  toggleOffBorder:  "#94a3b8",
  dayBtnOff:        "rgba(0,0,0,0.04)",
  dayBtnBorderOff:  "rgba(0,0,0,0.12)",
  scrollThumb:      "#cbd5e1",
  footerText:       "#94a3b8",
};

const ThemeCtx = createContext(DARK);
const useTheme = () => useContext(ThemeCtx);

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const DAY_NAMES        = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const HOURS_12         = Array.from({ length:12 }, (_,i) => i+1);
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
    return n===1 ? "Every minute" : "Every "+n+" minutes";
  }
  if (hour==="*" && dom==="*" && month==="*" && dow==="*" && !min.startsWith("*"))
    return "Every hour at :"+String(parseInt(min)).padStart(2,"0");
  const fmt = (h24,m) => {
    const ap=h24<12?"AM":"PM", h=h24===0?12:h24>12?h24-12:h24;
    return h+":"+String(m).padStart(2,"0")+" "+ap;
  };
  if (dom==="*"&&month==="*"&&dow==="*"&&!min.includes("*")&&!hour.includes("*"))
    return "Daily at "+fmt(parseInt(hour),parseInt(min));
  if (dom==="*"&&month==="*"&&!dow.includes("*")&&!min.includes("*")&&!hour.includes("*")) {
    const days=dow.split(",").map(d=>DAY_NAMES[parseInt(d)]||d).join(", ");
    return "Every "+days+" at "+fmt(parseInt(hour),parseInt(min));
  }
  if (!dom.includes("*")&&month==="*"&&dow==="*"&&!min.includes("*")&&!hour.includes("*"))
    return "Monthly on the "+(ORDINALS[parseInt(dom)-1]||dom)+" at "+fmt(parseInt(hour),parseInt(min));
  return expr;
}

// ─── CRON BUILDER / PARSER ────────────────────────────────────────────────────

function buildCron(s) {
  const h24 = s.ampm==="AM" ? (s.hour===12?0:parseInt(s.hour)) : (s.hour===12?12:parseInt(s.hour)+12);
  const m   = parseInt(s.minute ?? s.atMinute ?? "0");
  switch(s.freq) {
    case "minutes": return "*/"+s.interval+" * * * *";
    case "hourly":  return s.atMinute+" * * * *";
    case "daily":   return m+" "+h24+" * * *";
    case "weekly":  return m+" "+h24+" * * "+((s.days||[]).sort().join(",")||"0");
    case "monthly": return m+" "+h24+" "+s.dom+" * *";
    default:        return "* * * * *";
  }
}

function cronToState(expr) {
  const def = { freq:"daily", interval:30, atMinute:"0", hour:12, minute:"00", ampm:"PM", days:[], dom:1 };
  if (!expr) return def;
  const parts = expr.trim().split(/\s+/);
  if (parts.length!==5) return def;
  const [min,hour,dom,month,dow] = parts;
  const toAP = (h24) => ({ hour:h24===0?12:h24>12?h24-12:h24, ampm:parseInt(h24)<12?"AM":"PM" });
  const snap  = (m)   => String(Math.round(m/5)*5).padStart(2,"0");
  if (min.startsWith("*/")&&hour==="*"&&dom==="*"&&month==="*"&&dow==="*")
    return { ...def, freq:"minutes", interval:parseInt(min.slice(2)) };
  if (hour==="*"&&dom==="*"&&month==="*"&&dow==="*"&&!min.startsWith("*"))
    return { ...def, freq:"hourly", atMinute:String(parseInt(min)).padStart(2,"0") };
  if (dom==="*"&&month==="*"&&dow==="*"&&!min.includes("*")&&!hour.includes("*")) {
    const {hour:h,ampm}=toAP(parseInt(hour));
    return { ...def, freq:"daily", hour:h, minute:snap(parseInt(min)), ampm };
  }
  if (dom==="*"&&month==="*"&&!dow.includes("*")&&!min.includes("*")&&!hour.includes("*")) {
    const {hour:h,ampm}=toAP(parseInt(hour));
    return { ...def, freq:"weekly", hour:h, minute:snap(parseInt(min)), ampm, days:dow.split(",").map(Number) };
  }
  if (!dom.includes("*")&&month==="*"&&dow==="*"&&!min.includes("*")&&!hour.includes("*")) {
    const {hour:h,ampm}=toAP(parseInt(hour));
    return { ...def, freq:"monthly", hour:h, minute:snap(parseInt(min)), ampm, dom:parseInt(dom) };
  }
  return def;
}

// ─── RELATIVE TIME ────────────────────────────────────────────────────────────

function relativeTime(iso) {
  if (!iso) return null;
  const diff=new Date(iso).getTime()-Date.now(), abs=Math.abs(diff);
  const mins=Math.floor(abs/60000), hrs=Math.floor(abs/3600000), days=Math.floor(abs/86400000);
  const lbl = abs<60000?"just now":mins<60?mins+"m":hrs<24?hrs+"h":days+"d";
  return diff>0?"in "+lbl:lbl+" ago";
}

// ─── SHARED STYLE HELPERS ─────────────────────────────────────────────────────

function btnStyle(color, disabled=false) {
  return {
    fontSize:10, fontWeight:800, padding:"3px 10px", borderRadius:4,
    border:"1px solid "+(disabled?"#37415155":color+"55"),
    background:disabled?"rgba(128,128,128,0.06)":color+"18",
    color:disabled?"#94a3b8":color,
    cursor:disabled?"not-allowed":"pointer", letterSpacing:0.5,
  };
}

// ─── SCHEDULE PICKER ──────────────────────────────────────────────────────────

function SchedulePicker({ cronExpression, onSave, onCancel }) {
  const t = useTheme();
  const [s, setS] = useState(() => cronToState(cronExpression));
  const set = (k,v) => setS(p=>({...p,[k]:v}));
  const cron=buildCron(s), preview=parseCron(cron);
  const toggleDay = (d) => setS(p=>({ ...p, days:p.days.includes(d)?p.days.filter(x=>x!==d):[...p.days,d] }));
  const canSave = s.freq!=="weekly"||s.days.length>0;
  const sel = { background:t.selectBg, border:"1px solid "+t.selectBorder, borderRadius:4, color:t.text, fontSize:11, fontFamily:"inherit", padding:"3px 6px", cursor:"pointer", outline:"none" };

  return (
    <div style={{ background:t.pickerBg, border:"1px solid "+t.green+"4d", borderRadius:8, padding:"14px 14px 12px", marginTop:6, boxShadow:"0 4px 24px rgba(0,0,0,0.3)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <span style={{ fontSize:10, color:t.textMuted, fontWeight:700, width:72 }}>FREQUENCY</span>
        <select value={s.freq} onChange={e=>set("freq",e.target.value)} style={{ ...sel, fontWeight:700 }}>
          <option value="minutes">Every N Minutes</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      {s.freq==="minutes" && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
          <span style={{ fontSize:10, color:t.textMuted, fontWeight:700, width:72 }}>EVERY</span>
          <select value={s.interval} onChange={e=>set("interval",parseInt(e.target.value))} style={sel}>
            {INTERVAL_OPTIONS.map(n=><option key={n} value={n}>{n} {n===1?"minute":"minutes"}</option>)}
          </select>
        </div>
      )}
      {s.freq==="hourly" && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
          <span style={{ fontSize:10, color:t.textMuted, fontWeight:700, width:72 }}>AT MINUTE</span>
          <select value={s.atMinute} onChange={e=>set("atMinute",e.target.value)} style={sel}>
            {MINUTES.map(m=><option key={m} value={m}>:{m}</option>)}
          </select>
        </div>
      )}
      {s.freq==="weekly" && (
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:10, color:t.textMuted, fontWeight:700, marginBottom:6 }}>DAYS</div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {DAY_NAMES.map((name,i) => {
              const on=s.days.includes(i);
              return <button key={i} onClick={()=>toggleDay(i)} style={{ fontSize:10, fontWeight:800, padding:"4px 8px", borderRadius:5, border:"1px solid "+(on?t.green+"88":t.dayBtnBorderOff), background:on?t.green+"18":t.dayBtnOff, color:on?t.green:t.textMuted, cursor:"pointer" }}>{name}</button>;
            })}
          </div>
          {s.days.length===0&&<div style={{ fontSize:9, color:t.red, marginTop:4 }}>Select at least one day</div>}
        </div>
      )}
      {s.freq==="monthly" && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
          <span style={{ fontSize:10, color:t.textMuted, fontWeight:700, width:72 }}>DAY</span>
          <select value={s.dom} onChange={e=>set("dom",parseInt(e.target.value))} style={sel}>
            {ORDINALS.map((o,i)=><option key={i} value={i+1}>{o}</option>)}
          </select>
        </div>
      )}
      {["daily","weekly","monthly"].includes(s.freq) && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
          <span style={{ fontSize:10, color:t.textMuted, fontWeight:700, width:72 }}>TIME</span>
          <select value={s.hour}   onChange={e=>set("hour",parseInt(e.target.value))} style={sel}>{HOURS_12.map(h=><option key={h} value={h}>{h}</option>)}</select>
          <span style={{ color:t.textMuted, fontSize:12, fontWeight:700 }}>:</span>
          <select value={s.minute} onChange={e=>set("minute",e.target.value)} style={sel}>{MINUTES.map(m=><option key={m} value={m}>{m}</option>)}</select>
          <select value={s.ampm}   onChange={e=>set("ampm",e.target.value)} style={sel}><option value="AM">AM</option><option value="PM">PM</option></select>
        </div>
      )}
      <div style={{ borderTop:"1px solid "+t.inputBorder, paddingTop:10, marginBottom:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:10, color:t.green, fontWeight:700 }}>→</span>
          <span style={{ fontSize:11, color:t.text, fontWeight:600 }}>{preview}</span>
          <span style={{ fontSize:9, color:t.textDimmer, marginLeft:"auto", fontFamily:"monospace" }}>{cron}</span>
        </div>
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={()=>canSave&&onSave(cron)} disabled={!canSave} style={btnStyle(t.green,!canSave)}>✓ SAVE</button>
        <button onClick={onCancel} style={btnStyle(t.slate)}>✕ CANCEL</button>
      </div>
    </div>
  );
}

// ─── SCHEDULE EDITOR ──────────────────────────────────────────────────────────

function ScheduleEditor({ cronExpression, onSave }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom:open?4:8 }}>
      <div onClick={()=>setOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}>
        <span style={{ color:t.blue, fontSize:13 }}>⏱</span>
        <span style={{ fontSize:11, fontWeight:600, color:t.blue, borderBottom:"1px dotted "+t.blue+"66" }}>{parseCron(cronExpression)}</span>
        <span style={{ fontSize:9, color:open?t.green:t.textMuted }}>{open?"▲":"✎"}</span>
      </div>
      {open && <SchedulePicker cronExpression={cronExpression} onSave={cron=>{onSave(cron);setOpen(false);}} onCancel={()=>setOpen(false)} />}
    </div>
  );
}

// ─── EDITABLE FIELD ───────────────────────────────────────────────────────────

function EditableField({ value, onSave, textStyle, maxLength }) {
  const t = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);
  const inputRef              = useRef(null);
  useEffect(()=>{ if(editing&&inputRef.current) inputRef.current.focus(); },[editing]);
  const overLimit = maxLength && draft.length > maxLength;
  const commit = () => { if(overLimit) return; const v=draft.trim(); if(v&&v!==value) onSave(v); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };

  if (!editing) return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, cursor:"text", ...textStyle }}
      onClick={()=>{setDraft(value);setEditing(true);}}>
      {value}<span style={{ fontSize:9, color:t.textDim, opacity:0.8 }}>✎</span>
    </span>
  );
  return (
    <div style={{ width:"100%" }}>
      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
        <input ref={inputRef} value={draft}
          onChange={e=>setDraft(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter") commit(); if(e.key==="Escape") cancel(); }}
          style={{ flex:1, background:t.inputBg, border:"1px solid "+(overLimit?t.red:t.green)+"55", borderRadius:4, color:t.text, fontSize:textStyle?.fontSize||12, fontFamily:"inherit", fontWeight:textStyle?.fontWeight||"normal", padding:"4px 8px", outline:"none", minWidth:0 }}
        />
        <button onClick={commit} disabled={overLimit} style={btnStyle(t.green, overLimit)}>✓</button>
        <button onClick={cancel} style={btnStyle(t.red)}>✕</button>
      </div>
      {maxLength && (
        <div style={{ fontSize:8, textAlign:"right", marginTop:2, color:overLimit?t.red:t.textDim }}>
          {draft.length}/{maxLength}
        </div>
      )}
    </div>
  );
}

// ─── TOGGLE ───────────────────────────────────────────────────────────────────

function Toggle({ enabled, onChange }) {
  const t = useTheme();
  return (
    <div onClick={onChange} title={enabled?"Disable":"Enable"}
      style={{ width:36, height:20, borderRadius:10, cursor:"pointer", background:enabled?t.green:t.toggleOff, position:"relative", transition:"background 0.2s", flexShrink:0, border:"1px solid "+(enabled?t.green:t.toggleOffBorder) }}>
      <div style={{ width:14, height:14, borderRadius:"50%", background:"#fff", position:"absolute", top:2, left:enabled?18:2, transition:"left 0.2s", boxShadow:"0 1px 3px rgba(0,0,0,0.4)" }} />
    </div>
  );
}

// ─── TASK CARD ────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  active: { label:"ACTIVE", color:"#22c55e", pulse:true  },
  paused: { label:"PAUSED", color:"#f59e0b", pulse:false },
};

const EXIT_HINTS = {
  0:"Exit 0: Success",
  1:"Exit 1: General error",
  2:"Exit 2: Shell misuse",
  126:"Exit 126: Permission denied",
  127:"Exit 127: Command not found",
  130:"Exit 130: Terminated (Ctrl+C)",
  137:"Exit 137: Killed (OOM/SIGKILL)",
};

function ExitBadge({ exitCode, hasWrapper }) {
  const t = useTheme();
  if (!hasWrapper)   return <span style={{ fontSize:9, color:t.textSub, fontStyle:"italic" }}>no wrapper</span>;
  if (exitCode === null) return <span style={{ fontSize:9, color:t.textDim }}>—</span>;
  const ok = exitCode === 0;
  const hint = EXIT_HINTS[exitCode] || ("Exit "+exitCode+": Unknown");
  return (
    <span title={hint} style={{ fontSize:9, fontWeight:800, padding:"1px 6px", borderRadius:4, background:(ok?t.green:t.red)+"18", color:ok?t.green:t.red, border:"1px solid "+(ok?t.green:t.red)+"44", cursor:"help" }}>
      {ok ? "✓ OK" : "✗ ERR "+exitCode}
    </span>
  );
}

function NotesField({ value, onSave }) {
  const t = useTheme();
  const [draft, setDraft] = useState(value||"");
  const [status, setStatus] = useState(null);
  const dirty = draft !== (value||"");

  const handleBlur = async () => {
    if (!dirty) return;
    await onSave(draft);
    setStatus("✓ Saved");
    setTimeout(()=>setStatus(null), 2000);
  };

  return (
    <div style={{ marginTop:8 }}>
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
        <span style={{ fontSize:8, color:t.textMuted, fontWeight:700, letterSpacing:0.8 }}>NOTES</span>
        {dirty && !status && <span style={{ fontSize:8, color:t.amber }}>● unsaved</span>}
        {status && <span style={{ fontSize:8, color:t.green }}>{status}</span>}
        <span style={{ fontSize:8, color:t.textDim, marginLeft:"auto" }}>click away to save</span>
      </div>
      <textarea
        value={draft}
        onChange={e=>setDraft(e.target.value)}
        onBlur={handleBlur}
        placeholder="What does this job do? Dependencies, contacts, runbook link..."
        rows={2}
        style={{ width:"100%", boxSizing:"border-box", background:t.inputBg, border:"1px solid "+(dirty?t.amber+"66":t.inputBorder), borderRadius:4, color:t.text, fontSize:11, fontFamily:"inherit", padding:"5px 8px", outline:"none", resize:"vertical", lineHeight:1.5 }}
      />
    </div>
  );
}

function TaskCard({ task, onToggle, onEdit, onNotes, onDelete, onRefresh }) {
  const t       = useTheme();
  const scColor = task.enabled ? t.green : t.amber;
  const scLabel = task.enabled ? "ACTIVE" : "PAUSED";
  const nextRel = relativeTime(task.nextRunAt);
  const lastRel = task.lastRunAt ? relativeTime(task.lastRunAt) : null;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveMsg, setSaveMsg]             = useState(null);

  const handleFieldSave = async (changes) => {
    const result = await onEdit(task.taskId, changes);
    setSaveMsg(result === false ? "✗ Save failed" : "✓ Saved");
    setTimeout(() => setSaveMsg(null), 3000);
    if (result !== false) onRefresh();
  };

  const lbl = { fontSize:8, color:t.textMuted, fontWeight:700, letterSpacing:0.8, marginBottom:3 };

  return (
    <div style={{ background:t.cardBg, border:"1px solid "+(task.enabled?t.cardBorder:t.cardBorderOff), borderLeft:"3px solid "+scColor, borderRadius:10, padding:"10px 14px", opacity:task.enabled?1:0.65, transition:"opacity 0.2s" }}>

      {/* Top row */}
      <div style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={lbl}>DESCRIPTION</div>
          <EditableField
            value={task.description}
            onSave={val=>handleFieldSave({description:val})}
            textStyle={{ fontSize:12, fontWeight:800, color:t.text }}
            maxLength={80}
          />
          <div style={{ ...lbl, marginTop:6 }}>COMMAND</div>
          <EditableField
            value={task.command}
            onSave={val=>handleFieldSave({command:val})}
            textStyle={{ fontSize:11, color:t.blue, fontFamily:"monospace" }}
          />
          {saveMsg && (
            <div style={{ fontSize:9, marginTop:4, color: saveMsg.startsWith("✗") ? t.red : t.green }}>
              {saveMsg}
            </div>
          )}
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6, flexShrink:0 }}>
          <div style={{ fontSize:8, fontWeight:700, padding:"2px 8px", borderRadius:10, whiteSpace:"nowrap", background:scColor+"18", color:scColor, border:"1px solid "+scColor+"44", animation:task.enabled?"pulse 2s infinite":"none" }}>
            {task.enabled&&<span style={{ marginRight:3 }}>●</span>}{scLabel}
          </div>
          <Toggle enabled={task.enabled} onChange={()=>onToggle(task.taskId)} />
        </div>
      </div>

      {/* Schedule */}
      <ScheduleEditor cronExpression={task.cronExpression} onSave={cron=>onEdit(task.taskId,{cronExpression:cron})} />

      {/* Time grid + Delete */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:8, alignItems:"stretch" }}>
        <div style={{ background:t.inputBg, border:"1px solid "+t.inputBorder, borderRadius:6, padding:"6px 8px" }}>
          <div style={{ fontSize:8, color:t.textMuted, fontWeight:700, letterSpacing:0.8, marginBottom:2 }}>NEXT RUN</div>
          <div style={{ fontSize:11, color:task.enabled&&nextRel?.startsWith("in")?t.green:t.slate, fontWeight:700 }}>
            {task.enabled ? (nextRel||"—") : "Paused"}
          </div>
        </div>
        <div style={{ background:t.inputBg, border:"1px solid "+t.inputBorder, borderRadius:6, padding:"6px 8px" }}>
          <div style={{ fontSize:8, color:t.textMuted, fontWeight:700, letterSpacing:0.8, marginBottom:3 }}>LAST RUN</div>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:11, color:t.slate, fontWeight:700 }}>{lastRel||<span style={{ color:t.textDim }}>Never</span>}</span>
            <ExitBadge exitCode={task.exitCode} hasWrapper={task.hasWrapper} />
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end" }}>
          {confirmDelete ? (
            <div style={{ display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ fontSize:9, color:t.red, whiteSpace:"nowrap" }}>Delete?</span>
              <button onClick={()=>onDelete(task.taskId)} style={btnStyle(t.red)}>YES</button>
              <button onClick={()=>setConfirmDelete(false)} style={btnStyle(t.slate)}>NO</button>
            </div>
          ) : (
            <button onClick={()=>setConfirmDelete(true)} style={{ ...btnStyle(t.red), padding:"3px 8px" }}>🗑</button>
          )}
        </div>
      </div>

      {/* Notes */}
      <NotesField value={task.notes} onSave={text=>onNotes(task.taskId, text)} />
    </div>
  );
}

// ─── ADD JOB FORM ─────────────────────────────────────────────────────────────

function AddJobForm({ onSave, onCancel }) {
  const t = useTheme();
  const [command, setCommand]       = useState("");
  const [cronExpr, setCronExpr]     = useState("0 9 * * *");
  const [pickerOpen, setPickerOpen] = useState(false);
  const canSave = command.trim().length > 0;

  return (
    <div style={{ background:t.green+"08", border:"1px solid "+t.green+"33", borderRadius:10, padding:"14px", marginBottom:10 }}>
      <div style={{ fontSize:10, fontWeight:800, color:t.green, letterSpacing:1, marginBottom:12 }}>+ ADD CRON JOB</div>
      <div style={{ marginBottom:10 }}>
        <div style={{ fontSize:10, color:t.textMuted, fontWeight:700, marginBottom:4 }}>COMMAND</div>
        <input value={command} onChange={e=>setCommand(e.target.value)} placeholder="/path/to/script.sh"
          style={{ width:"100%", background:t.inputBg, border:"1px solid "+t.inputBorder, borderRadius:4, color:t.text, fontSize:11, fontFamily:"'JetBrains Mono','Fira Code',monospace", padding:"5px 8px", outline:"none", boxSizing:"border-box" }}
        />
      </div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:10, color:t.textMuted, fontWeight:700, marginBottom:4 }}>SCHEDULE</div>
        <div onClick={()=>setPickerOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}>
          <span style={{ color:t.textMuted }}>⏱</span>
          <span style={{ fontSize:11, fontWeight:600, color:t.textSub, borderBottom:"1px dotted "+t.textDim }}>{parseCron(cronExpr)}</span>
          <span style={{ fontSize:9, color:pickerOpen?t.green:t.textDim }}>{pickerOpen?"▲":"✎"}</span>
        </div>
        {pickerOpen && <SchedulePicker cronExpression={cronExpr} onSave={cron=>{setCronExpr(cron);setPickerOpen(false);}} onCancel={()=>setPickerOpen(false)} />}
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={()=>canSave&&onSave(cronExpr,command.trim())} disabled={!canSave} style={btnStyle(t.green,!canSave)}>✓ ADD JOB</button>
        <button onClick={onCancel} style={btnStyle(t.slate)}>✕ CANCEL</button>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function CronVisualizer() {
  const [isDark, setIsDark]             = useState(true);
  const t                               = isDark ? DARK : LIGHT;
  const [tasks, setTasks]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [lastRefresh, setRefresh]       = useState(new Date());
  const [refreshing, setRefreshing]     = useState(false);
  const [showAddForm, setShowAddForm]   = useState(false);
  const [hideDisabled, setHideDisabled] = useState(false);
  const [serverName, setServerName]     = useState("");
  const [, setTick]                     = useState(0);

  useEffect(()=>{ const iv=setInterval(()=>setTick(n=>n+1),30000); return()=>clearInterval(iv); },[]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(API_URL+"/crons", { headers:API_HEADERS, cache:"no-store" });
      if (!res.ok) throw new Error("Server returned "+res.status);
      const data = await res.json();
      setTasks(data.map(e=>({ taskId:String(e.index), index:e.index, description:e.command, command:e.command, cronExpression:e.cronExpression, enabled:e.enabled, nextRunAt:e.nextRunAt||null, lastRunAt:e.lastRunAt||null, exitCode:e.exitCode??null, hasWrapper:e.hasWrapper||false, notes:e.notes||"" })));
      setError(null);
    } catch(err) { setError(err.message); }
  },[]);

  useEffect(()=>{
    fetch(API_URL+"/info",{headers:API_HEADERS,cache:"no-store"})
      .then(r=>r.json()).then(d=>setServerName(d.serverName||"")).catch(()=>{});
    fetchTasks().then(()=>setLoading(false));
  },[fetchTasks]);

  const handleRefresh = useCallback(()=>{
    setRefreshing(true);
    fetchTasks().then(()=>{ setRefresh(new Date()); setRefreshing(false); });
  },[fetchTasks]);

  const handleToggle = useCallback(async (id) => {
    const task=tasks.find(t=>t.taskId===id); if(!task) return;
    setTasks(p=>p.map(t=>t.taskId===id?{...t,enabled:!t.enabled}:t));
    try {
      const res=await fetch(API_URL+"/crons/toggle",{method:"POST",headers:API_HEADERS,body:JSON.stringify({index:task.index})});
      if(!res.ok) throw new Error();
    } catch { setTasks(p=>p.map(t=>t.taskId===id?{...t,enabled:task.enabled}:t)); }
  },[tasks]);

  const handleEdit = useCallback(async (id, changes) => {
    const task=tasks.find(t=>t.taskId===id); if(!task) return;
    setTasks(p=>p.map(t=>t.taskId===id?{...t,...changes}:t));
    if (changes.cronExpression || changes.command) {
      try {
        const payload = { index: task.index };
        if (changes.cronExpression) payload.cronExpression = changes.cronExpression;
        if (changes.command)        payload.command        = changes.command;
        const res=await fetch(API_URL+"/crons/update",{method:"POST",headers:API_HEADERS,body:JSON.stringify(payload)});
        if(!res.ok) throw new Error();
        return true;
      } catch {
        setTasks(p=>p.map(t=>t.taskId===id?{...t,...task}:t));
        return false;
      }
    }
  },[tasks]);

  const handleNotes = useCallback(async (id, text) => {
    const task=tasks.find(t=>t.taskId===id); if(!task) return;
    setTasks(p=>p.map(t=>t.taskId===id?{...t,notes:text}:t));
    await fetch(API_URL+"/crons/notes",{method:"POST",headers:API_HEADERS,body:JSON.stringify({index:task.index,notes:text})});
  },[tasks]);

  const handleDelete = useCallback(async (id) => {
    const task=tasks.find(t=>t.taskId===id); if(!task) return;
    setTasks(p=>p.filter(t=>t.taskId!==id));
    try {
      await fetch(API_URL+"/crons/delete",{method:"POST",headers:API_HEADERS,body:JSON.stringify({index:task.index})});
    } finally { fetchTasks(); }
  },[tasks,fetchTasks]);

  const handleAdd = useCallback(async (cronExpression, command) => {
    try {
      const res=await fetch(API_URL+"/crons/add",{method:"POST",headers:API_HEADERS,body:JSON.stringify({cronExpression,command})});
      if(!res.ok) throw new Error();
      setShowAddForm(false); fetchTasks();
    } catch(err) { alert("Failed to add job: "+err.message); }
  },[fetchTasks]);

  const active      = tasks.filter(t=>t.enabled).length;
  const paused      = tasks.filter(t=>!t.enabled).length;
  const visibleTasks = hideDisabled ? tasks.filter(t=>t.enabled) : tasks;

  return (
    <ThemeCtx.Provider value={t}>
      <div style={{ fontFamily:"'JetBrains Mono','Fira Code','Courier New',monospace", background:t.bg, color:t.text, height:"100vh", display:"flex", flexDirection:"column", fontSize:12, transition:"background 0.2s, color 0.2s" }}>

        {/* Sticky header */}
        <div style={{ flexShrink:0, background:t.bg, padding:"12px 12px 10px", borderBottom:"1px solid "+t.headerBorder, zIndex:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:t.green, boxShadow:"0 0 10px "+t.green, animation:"pulse 2s infinite", flexShrink:0 }} />
            <span style={{ fontSize:14, fontWeight:800, color:t.green, letterSpacing:2 }}>CRON VISUALIZER</span>
            {serverName && <span style={{ fontSize:9, fontWeight:700, padding:"2px 8px", borderRadius:4, background:t.blue+"18", color:t.blue, border:"1px solid "+t.blue+"44" }}>{serverName}</span>}
            <span style={{ fontSize:9, fontWeight:700, padding:"2px 8px", borderRadius:4, background:t.green+"22", color:t.green, border:"1px solid "+t.green+"44" }}>{active} ACTIVE</span>
            {paused>0&&<span style={{ fontSize:9, fontWeight:700, padding:"2px 8px", borderRadius:4, background:t.amber+"22", color:t.amber, border:"1px solid "+t.amber+"44" }}>{paused} PAUSED</span>}

            <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <div onClick={()=>setIsDark(d=>!d)} title={isDark?"Switch to light mode":"Switch to dark mode"}
                style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer", fontSize:10, color:t.slate, padding:"3px 8px", borderRadius:4, border:"1px solid "+t.inputBorder, background:t.inputBg, userSelect:"none" }}>
                <span>{isDark?"☀":"🌙"}</span>
                <span style={{ fontWeight:700, letterSpacing:0.5 }}>{isDark?"LIGHT":"DARK"}</span>
              </div>
              <button onClick={()=>setHideDisabled(h=>!h)} style={{ fontSize:9, fontWeight:700, padding:"3px 10px", borderRadius:4, background:hideDisabled?t.amber+"25":t.inputBg, border:"1px solid "+(hideDisabled?t.amber+"55":t.inputBorder), color:hideDisabled?t.amber:t.slate, cursor:"pointer", letterSpacing:0.5 }}>
                {hideDisabled?"SHOW ALL":"HIDE PAUSED"}
              </button>
              <button onClick={()=>setShowAddForm(s=>!s)} style={{ fontSize:9, fontWeight:700, padding:"3px 10px", borderRadius:4, background:showAddForm?t.green+"25":t.green+"0d", border:"1px solid "+t.green+"44", color:t.green, cursor:"pointer", letterSpacing:0.5 }}>
                {showAddForm?"✕ CANCEL":"+ ADD JOB"}
              </button>
              <span style={{ fontSize:9, color:t.textDim }}>{new Date(lastRefresh).toLocaleTimeString()}</span>
              <button onClick={handleRefresh} disabled={refreshing} style={{ fontSize:9, fontWeight:700, padding:"3px 10px", borderRadius:4, background:t.inputBg, border:"1px solid "+t.inputBorder, color:refreshing?t.textMuted:t.slate, cursor:refreshing?"wait":"pointer", letterSpacing:0.5 }}>
                {refreshing?"⟳ REFRESHING...":"⟳ REFRESH"}
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex:1, overflowY:"auto", padding:"12px" }}>

          {/* Error banner */}
          {error && (
            <div style={{ marginBottom:14, padding:"10px 14px", borderRadius:8, background:t.red+"12", border:"1px solid "+t.red+"44", color:t.red, fontSize:11, display:"flex", alignItems:"center", gap:8 }}>
              <span>⚠</span><span>Cannot reach server — {error}</span>
              <span style={{ fontSize:9, color:t.slate, marginLeft:"auto" }}>Is the SSH tunnel running? Is cron_api.py running?</span>
            </div>
          )}

          {/* Stats */}
          {!loading&&!error&&(
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:14 }}>
              {[{label:"Total Jobs",value:tasks.length,color:t.blue},{label:"Active",value:active,color:t.green},{label:"Paused",value:paused,color:t.amber}].map(({label,value,color})=>(
                <div key={label} style={{ background:t.statBg(color), border:"1px solid "+t.statBorder(color), borderRadius:8, padding:"8px 12px", textAlign:"center" }}>
                  <div style={{ fontSize:20, fontWeight:800, color }}>{value}</div>
                  <div style={{ fontSize:9, color:t.textMuted, fontWeight:700, letterSpacing:0.5, marginTop:2 }}>{label.toUpperCase()}</div>
                </div>
              ))}
            </div>
          )}

          {/* Add form */}
          {showAddForm&&<AddJobForm onSave={handleAdd} onCancel={()=>setShowAddForm(false)} />}

          {/* Cards */}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {loading ? (
              <div style={{ textAlign:"center", padding:"40px 20px", color:t.textDim }}>
                <div style={{ fontSize:20, marginBottom:8, animation:"pulse 1s infinite" }}>⟳</div>
                <div style={{ fontSize:11 }}>Connecting to {API_URL}...</div>
              </div>
            ) : visibleTasks.length===0&&!error ? (
              <div style={{ textAlign:"center", padding:"40px 20px", background:t.cardBg, border:"1px solid "+t.cardBorder, borderRadius:10, color:t.textDim }}>
                <div style={{ fontSize:28, marginBottom:8 }}>📭</div>
                <div style={{ fontSize:12 }}>{hideDisabled?"No active jobs":"No cron jobs found"}</div>
                <div style={{ fontSize:10, marginTop:4 }}>{hideDisabled?"Toggle SHOW ALL to see paused jobs":"Use + ADD JOB to create one"}</div>
              </div>
            ) : visibleTasks.map(task=>(
              <TaskCard key={task.taskId} task={task} onToggle={handleToggle} onEdit={handleEdit} onNotes={handleNotes} onDelete={handleDelete} onRefresh={handleRefresh} />
            ))}
          </div>

          {/* Footer */}
          <div style={{ marginTop:14, paddingTop:10, borderTop:"1px solid "+t.inputBorder, display:"flex", justifyContent:"space-between", fontSize:9, color:t.footerText }}>
            <span>CRON VISUALIZER · SPRINT 6</span>
            <span>{API_URL} · {new Date().toLocaleDateString()}</span>
          </div>

        </div>

        <style>{`
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
          ::-webkit-scrollbar { width:4px }
          ::-webkit-scrollbar-thumb { background:${t.scrollThumb}; border-radius:2px }
          button:hover:not(:disabled) { filter:brightness(1.15) }
          select option { background:${t.bg} }
          input::placeholder { color:${t.textDim} }
          textarea::placeholder { color:${t.textDim} }
          textarea { color-scheme: ${isDark?"dark":"light"} }
        `}</style>
      </div>
    </ThemeCtx.Provider>
  );
}

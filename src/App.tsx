import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import {
  Search, Loader2, Car, Save, Library, AlertTriangle,
  TrendingDown, Share2, Fuel, Settings2, Trash2, Shield,
  CheckCircle, XCircle, BarChart3, ChevronRight, Zap, BadgeCheck,
} from 'lucide-react';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

// ── Types ─────────────────────────────────────────────────────────────────────
interface VehicleInfo {
  year: number; make: string; model: string; trim: string;
  bodyClass: string; fuelType: string; driveType: string;
  engineCylinders: string; displacement: string;
}
interface Factors {
  age: number; rate: string; region: string; regionLabel: string;
  condition: number; mileageLabel: string; conditionLabel: string;
  baseMsrp: number; depPct: string;
}
interface Recall { id: string; component: string; summary: string; remedy: string; }
interface EvalResult {
  vehicle: VehicleInfo;
  value: number;
  range: { low: number; high: number };
  projection: { labels: string[]; data: number[] };
  strategy: string;
  factors: Factors;
  recalls: Recall[];
}
interface SavedVehicle {
  id: string; vin: string; savedAt: number;
  vehicle: VehicleInfo; value: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const CONDITIONS = [
  { label: 'Poor',      desc: 'Major issues',    color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  { label: 'Fair',      desc: 'Visible wear',    color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
  { label: 'Good',      desc: 'Normal wear',     color: '#eab308', bg: 'rgba(234,179,8,0.15)' },
  { label: 'V.Good',    desc: 'Well maintained', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  { label: 'Excellent', desc: 'Like new',        color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
];

const LOADING_STEPS = [
  'Decoding VIN via NHTSA…',
  'Applying valuation model…',
  'Checking recalls & safety data…',
  'Building strategy report…',
];

// ── Garage helpers (localStorage, no login needed) ────────────────────────────
const GARAGE_KEY = 'vinsight-garage';
function loadGarage(): SavedVehicle[] {
  try { return JSON.parse(localStorage.getItem(GARAGE_KEY) || '[]'); } catch { return []; }
}
function persistGarage(list: SavedVehicle[]) {
  localStorage.setItem(GARAGE_KEY, JSON.stringify(list));
}

// ── Animated counter hook ─────────────────────────────────────────────────────
function useCountUp(target: number, duration = 1400) {
  const [val, setVal] = useState(0);
  const raf = useRef<number>(0);
  useEffect(() => {
    if (!target) return;
    const start = Date.now();
    const step = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(target * eased));
      if (progress < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return val;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
interface ToastState { msg: string; type: 'success' | 'error' | 'info'; }
function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3200); return () => clearTimeout(t); }, [toast]);
  const icon = toast.type === 'success' ? <CheckCircle className="w-4 h-4" />
    : toast.type === 'error' ? <XCircle className="w-4 h-4" /> : <Zap className="w-4 h-4" />;
  const color = toast.type === 'success' ? '#22c55e' : toast.type === 'error' ? '#ef4444' : '#3b82f6';
  return (
    <div className="fixed top-5 right-5 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium shadow-2xl"
      style={{ background: '#18181b', borderColor: color }}>
      <span style={{ color }}>{icon}</span>
      <span className="text-zinc-100">{toast.msg}</span>
    </div>
  );
}

// ── VIN validator ─────────────────────────────────────────────────────────────
function vinStatus(vin: string): 'empty' | 'typing' | 'invalid' | 'valid' {
  if (!vin) return 'empty';
  if (vin.length < 17) return 'typing';
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) return 'valid';
  return 'invalid';
}

// ── Factor Row ────────────────────────────────────────────────────────────────
function FactorRow({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const isNeutral = value.includes('base') || value.includes('Avg') || value === '0%';
  const color = isNeutral ? '#a1a1aa' : positive === true ? '#22c55e' : '#f97316';
  return (
    <div className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
      <span className="text-[13px] text-zinc-400">{label}</span>
      <span className="text-[13px] font-semibold" style={{ color }}>{value}</span>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [vin, setVin] = useState('');
  const [mileage, setMileage] = useState('');
  const [zip, setZip] = useState('');
  const [condition, setCondition] = useState(3);
  const [loading, setLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<EvalResult | null>(null);
  const [garage, setGarage] = useState<SavedVehicle[]>(loadGarage);
  const [view, setView] = useState<'evaluate' | 'garage'>('evaluate');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [activeSection, setActiveSection] = useState<'overview' | 'projection'>('overview');
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const displayValue = useCountUp(result?.value ?? 0);
  const showToast = useCallback((msg: string, type: ToastState['type'] = 'info') => setToast({ msg, type }), []);

  const startSteps = () => {
    setStepIdx(0);
    let i = 0;
    stepTimer.current = setInterval(() => {
      i++;
      if (i < LOADING_STEPS.length) setStepIdx(i);
      else clearInterval(stepTimer.current!);
    }, 700);
  };

  const handleEvaluate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (vinStatus(vin) !== 'valid') { setError('Please enter a valid 17-character VIN.'); return; }
    setLoading(true);
    setError('');
    setResult(null);
    startSteps();
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vin, mileage, zip, condition }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Evaluation failed');
      setResult(data);
      setActiveSection('overview');
    } catch (err: any) {
      setError(err.message);
    } finally {
      if (stepTimer.current) clearInterval(stepTimer.current);
      setLoading(false);
    }
  };

  const saveToGarage = () => {
    if (!result) return;
    const already = garage.find(v => v.vin === vin);
    if (already) { showToast('Already in garage.', 'info'); return; }
    const entry: SavedVehicle = { id: crypto.randomUUID(), vin, vehicle: result.vehicle, value: result.value, savedAt: Date.now() };
    const updated = [entry, ...garage];
    setGarage(updated);
    persistGarage(updated);
    showToast('Saved to garage!', 'success');
  };

  const removeFromGarage = (id: string) => {
    const updated = garage.filter(v => v.id !== id);
    setGarage(updated);
    persistGarage(updated);
    showToast('Removed from garage.', 'info');
  };

  const shareResult = () => {
    if (!result) return;
    const { vehicle: v, value, range, factors } = result;
    const text = `VINSight Report — ${v.year} ${v.make} ${v.model}${v.trim ? ' ' + v.trim : ''}
Estimated Value: $${value.toLocaleString()} (range $${range.low.toLocaleString()}–$${range.high.toLocaleString()})
Region: ${factors.region} · Condition: ${factors.condition}/5
12-month depreciation: ~${factors.depPct}%
Strategy: ${result.strategy}`;
    navigator.clipboard.writeText(text)
      .then(() => showToast('Copied to clipboard!', 'success'))
      .catch(() => showToast('Copy failed.', 'error'));
  };

  const chartData = {
    labels: result?.projection.labels ?? [],
    datasets: [{
      fill: true, label: 'Value',
      data: result?.projection.data ?? [],
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59,130,246,0.07)',
      tension: 0.4, pointRadius: 3, pointHoverRadius: 6,
      pointBackgroundColor: '#3b82f6',
    }],
  };

  const chartOptions: any = {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 800 },
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx: any) => ` $${ctx.parsed.y.toLocaleString()}` } } },
    scales: {
      y: { grid: { color: '#1f1f23' }, ticks: { color: '#52525b', callback: (v: any) => `$${(v / 1000).toFixed(0)}k` } },
      x: { grid: { display: false }, ticks: { color: '#52525b' } },
    },
  };

  const vs = vinStatus(vin);

  return (
    <div className="min-h-screen bg-[#09090b] text-[#fafafa] font-sans">
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {/* Navbar */}
      <nav className="border-b border-zinc-900 bg-[#09090b]/90 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => setView('evaluate')} className="flex items-center gap-2 font-black text-lg tracking-tight">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <Car className="w-4 h-4" />
            </div>
            VIN<span className="text-blue-500">SIGHT</span>
          </button>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              100% Free
            </span>
            <button
              onClick={() => setView(view === 'garage' ? 'evaluate' : 'garage')}
              className={`flex items-center gap-1.5 text-[13px] font-medium transition-colors ${view === 'garage' ? 'text-blue-400' : 'text-zinc-400 hover:text-white'}`}
            >
              <Library className="w-3.5 h-3.5" />
              Garage {garage.length > 0 && <span className="bg-zinc-800 text-zinc-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{garage.length}</span>}
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {view === 'evaluate' ? (
          <div className="flex flex-col lg:flex-row gap-6 items-start">

            {/* Input Panel */}
            <div className="w-full lg:w-[340px] lg:sticky lg:top-24 flex flex-col gap-4 lg:order-2">
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-4">Asset Evaluation</p>
                <form onSubmit={handleEvaluate} className="space-y-4">

                  {/* VIN */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-zinc-400">VIN Number *</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                        {vs === 'valid' ? <BadgeCheck className="h-4 w-4 text-emerald-400" />
                          : vs === 'invalid' ? <XCircle className="h-4 w-4 text-red-400" />
                          : <Search className="h-4 w-4 text-zinc-500" />}
                      </div>
                      <input
                        type="text" value={vin}
                        onChange={e => setVin(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/gi, ''))}
                        className={`block w-full pl-10 pr-12 py-2.5 bg-black border rounded-lg text-white placeholder-zinc-600 text-sm focus:outline-none transition-colors ${
                          vs === 'valid' ? 'border-emerald-500/50 focus:border-emerald-500'
                          : vs === 'invalid' ? 'border-red-500/40 focus:border-red-500'
                          : 'border-zinc-800 focus:border-blue-500'}`}
                        placeholder="17-character VIN" maxLength={17}
                      />
                      <span className={`absolute inset-y-0 right-0 pr-3 flex items-center text-[11px] font-mono ${vin.length === 17 ? 'text-emerald-400' : 'text-zinc-600'}`}>
                        {vin.length}/17
                      </span>
                    </div>
                    {vs === 'invalid' && <p className="text-[11px] text-red-400">Invalid format — A–Z (no I/O/Q) and 0–9 only.</p>}
                  </div>

                  {/* Mileage */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-zinc-400">Mileage</label>
                    <input type="number" value={mileage} onChange={e => setMileage(e.target.value)}
                      className="block w-full px-3 py-2.5 bg-black border border-zinc-800 rounded-lg text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                      placeholder="e.g. 45000" min={0} />
                  </div>

                  {/* ZIP */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-zinc-400">ZIP Code <span className="text-zinc-600">(regional pricing)</span></label>
                    <input type="text" value={zip} onChange={e => setZip(e.target.value.replace(/\D/g, ''))}
                      className="block w-full px-3 py-2.5 bg-black border border-zinc-800 rounded-lg text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                      placeholder="e.g. 90210" maxLength={5} />
                  </div>

                  {/* Condition */}
                  <div className="space-y-2">
                    <label className="text-[12px] text-zinc-400">
                      Condition —{' '}
                      <span style={{ color: CONDITIONS[condition - 1].color }}>
                        {CONDITIONS[condition - 1].label}: {CONDITIONS[condition - 1].desc}
                      </span>
                    </label>
                    <div className="flex gap-1.5">
                      {CONDITIONS.map((c, i) => (
                        <button key={i} type="button" onClick={() => setCondition(i + 1)}
                          className="flex-1 py-2 rounded-lg text-[11px] font-bold border transition-all"
                          style={condition === i + 1
                            ? { background: c.bg, borderColor: c.color, color: c.color }
                            : { background: 'transparent', borderColor: '#27272a', color: '#52525b' }}>
                          {i + 1}
                        </button>
                      ))}
                    </div>
                  </div>

                  {error && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] flex items-start gap-2">
                      <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
                    </div>
                  )}

                  <button type="submit" disabled={loading || vs === 'invalid'}
                    className="w-full mt-1 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm">
                    {loading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /><span className="text-[13px] truncate">{LOADING_STEPS[stepIdx]}</span></>
                    ) : (
                      <>Run Evaluation <ChevronRight className="w-4 h-4" /></>
                    )}
                  </button>
                </form>
              </div>

              {/* Free features card */}
              {!result && (
                <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-4 space-y-2.5">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-600">Everything included — free</p>
                  {[
                    ['NHTSA VIN Decode', 'Make, model, engine, drivetrain'],
                    ['Recall Check', 'Live NHTSA safety recall data'],
                    ['Market Valuation', 'Brand-specific depreciation engine'],
                    ['12-Month Projection', 'Forward value curve'],
                    ['Hold/Sell Strategy', 'Smart rule-based advice'],
                    ['Garage', 'Save locally — no login needed'],
                  ].map(([title, sub]) => (
                    <div key={title} className="flex items-start gap-2">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-[12px] font-medium text-zinc-300">{title}</p>
                        <p className="text-[11px] text-zinc-600">{sub}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Results */}
            <div className="w-full lg:flex-1 lg:order-1 min-w-0">
              {result ? (
                <div className="flex flex-col gap-5">

                  {/* Vehicle header */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <h1 className="text-2xl font-black tracking-tight">
                          {result.vehicle.year} {result.vehicle.make} {result.vehicle.model}
                          {result.vehicle.trim && <span className="text-zinc-500 font-normal text-lg ml-2">{result.vehicle.trim}</span>}
                        </h1>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {result.vehicle.displacement && (
                            <span className="flex items-center gap-1 text-[11px] text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full">
                              <Settings2 className="w-3 h-3" /> {result.vehicle.displacement} {result.vehicle.engineCylinders}
                            </span>
                          )}
                          {result.vehicle.fuelType && (
                            <span className="flex items-center gap-1 text-[11px] text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full">
                              <Fuel className="w-3 h-3" /> {result.vehicle.fuelType}
                            </span>
                          )}
                          {result.vehicle.driveType && (
                            <span className="text-[11px] text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full">{result.vehicle.driveType}</span>
                          )}
                          {result.vehicle.bodyClass && (
                            <span className="text-[11px] text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full">
                              {result.vehicle.bodyClass.split('/')[0]}
                            </span>
                          )}
                          {result.recalls.length > 0 && (
                            <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
                              <AlertTriangle className="w-3 h-3" /> {result.recalls.length} Recall{result.recalls.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={shareResult}
                          className="flex items-center gap-1.5 text-[12px] text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 px-3 py-2 rounded-lg transition-colors">
                          <Share2 className="w-3.5 h-3.5" /> Share
                        </button>
                        <button onClick={saveToGarage}
                          className="flex items-center gap-1.5 text-[12px] text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 px-3 py-2 rounded-lg transition-colors">
                          <Save className="w-3.5 h-3.5" /> Save
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Value card */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                    <p className="text-[12px] font-semibold uppercase tracking-widest text-zinc-500 mb-1">Estimated Market Value</p>
                    <div className="flex items-end gap-3 mb-5">
                      <span className="text-5xl font-black tracking-tighter">${displayValue.toLocaleString()}</span>
                      <span className="text-zinc-500 text-sm pb-2">mid-market</span>
                    </div>
                    <div className="space-y-2">
                      <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(to right, #1d4ed8, #3b82f6, #60a5fa)' }} />
                        <div className="absolute inset-y-0 w-0.5 bg-white/50" style={{ left: '50%' }} />
                      </div>
                      <div className="flex justify-between">
                        <div>
                          <p className="text-[11px] text-zinc-600">Conservative</p>
                          <p className="text-[14px] font-bold text-zinc-300">${result.range.low.toLocaleString()}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] text-zinc-600">Optimistic</p>
                          <p className="text-[14px] font-bold text-zinc-300">${result.range.high.toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
                    {(['overview', 'projection'] as const).map(s => (
                      <button key={s} onClick={() => setActiveSection(s)}
                        className={`flex-1 py-2 text-[13px] font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${activeSection === s ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
                        {s === 'overview' ? <><TrendingDown className="w-3.5 h-3.5" />Overview</> : <><BarChart3 className="w-3.5 h-3.5" />Projection</>}
                      </button>
                    ))}
                  </div>

                  {activeSection === 'overview' ? (
                    <>
                      {/* Strategy */}
                      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <Zap className="w-4 h-4 text-blue-400" />
                          <span className="text-[12px] font-bold uppercase tracking-wider text-zinc-400">Hold / Sell Strategy</span>
                        </div>
                        <p className="text-[15px] leading-relaxed text-zinc-200">{result.strategy}</p>
                      </div>

                      {/* Factors */}
                      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                        <p className="text-[12px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Value Factors</p>
                        <p className="text-[11px] text-zinc-600 mb-3">Base MSRP estimate: ${result.factors.baseMsrp.toLocaleString()}</p>
                        <FactorRow label={`Brand depreciation (${result.vehicle.make})`} value={`${result.factors.rate}%/yr`} />
                        <FactorRow label={`Age (${result.factors.age} yr${result.factors.age !== 1 ? 's' : ''})`} value={`−${(100 - Math.pow(1 - parseFloat(result.factors.rate) / 100, result.factors.age) * 100).toFixed(1)}%`} />
                        <FactorRow label="Mileage" value={result.factors.mileageLabel} positive={result.factors.mileageLabel.startsWith('Very Low') || result.factors.mileageLabel.startsWith('Low')} />
                        <FactorRow label={`Condition (${result.factors.condition}/5)`} value={result.factors.conditionLabel} positive={result.factors.condition >= 4} />
                        <FactorRow label={`Region (${result.factors.region})`} value={result.factors.regionLabel} positive={!result.factors.regionLabel.startsWith('−')} />
                        <FactorRow label="12-month depreciation forecast" value={`−${result.factors.depPct}%`} />
                      </div>

                      {/* Recalls */}
                      {result.recalls.length > 0 ? (
                        <div className="bg-amber-400/5 border border-amber-400/20 rounded-2xl p-5">
                          <div className="flex items-center gap-2 mb-3">
                            <Shield className="w-4 h-4 text-amber-400" />
                            <span className="text-[12px] font-bold uppercase tracking-wider text-amber-400">
                              {result.recalls.length} NHTSA Recall{result.recalls.length > 1 ? 's' : ''} Found
                            </span>
                          </div>
                          <div className="space-y-3">
                            {result.recalls.map((r, i) => (
                              <div key={i} className="bg-black/30 rounded-xl p-3 space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[12px] font-bold text-amber-300">{r.component}</span>
                                  <span className="text-[10px] text-zinc-600 font-mono">{r.id}</span>
                                </div>
                                <p className="text-[12px] text-zinc-400 leading-relaxed">{r.summary}</p>
                                {r.remedy && <p className="text-[11px] text-zinc-500">Remedy: {r.remedy}</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 p-3 bg-emerald-400/5 border border-emerald-400/10 rounded-xl text-[13px] text-emerald-400">
                          <CheckCircle className="w-4 h-4 flex-shrink-0" />
                          No open NHTSA recalls found for this vehicle.
                        </div>
                      )}
                    </>
                  ) : (
                    /* Projection Chart */
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-[12px] font-bold uppercase tracking-wider text-zinc-500">12-Month Value Projection</p>
                        <div className="text-right">
                          <p className="text-[11px] text-zinc-500">Est. in 12 months</p>
                          <p className="text-[15px] font-bold text-red-400">
                            ${(result.projection.data[12] ?? 0).toLocaleString()}
                            <span className="text-[12px] text-zinc-500 ml-1">(−{result.factors.depPct}%)</span>
                          </p>
                        </div>
                      </div>
                      <div className="h-[220px]"><Line data={chartData} options={chartOptions} /></div>
                      <p className="text-[11px] text-zinc-600 mt-3">
                        {result.vehicle.make} average {result.factors.rate}%/yr rate, compounded monthly.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* Empty state */
                <div className="flex flex-col items-center justify-center min-h-[420px] border border-zinc-800/50 rounded-2xl bg-zinc-900/20 p-8 text-center space-y-5">
                  <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                    <Car className="w-8 h-8 text-zinc-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black tracking-tight">Know Your Car's True Worth</h2>
                    <p className="text-zinc-500 text-sm mt-2 max-w-xs mx-auto">
                      Enter any 17-digit VIN for an instant market valuation, NHTSA recall check, and 12-month projection.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
                    {[['🔓', 'No keys needed'], ['🔍', 'Real NHTSA data'], ['📊', 'Brand-specific rates']].map(([icon, label]) => (
                      <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                        <div className="text-xl mb-1">{icon}</div>
                        <p className="text-[11px] text-zinc-500 font-medium">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Garage View */
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
                <Library className="w-5 h-5 text-blue-400" /> My Garage
                <span className="text-zinc-600 text-sm font-normal ml-1">— saved locally in your browser</span>
              </h2>
              <button onClick={() => setView('evaluate')} className="text-[13px] text-zinc-400 hover:text-white flex items-center gap-1 transition-colors">
                + Evaluate a vehicle
              </button>
            </div>

            {garage.length === 0 ? (
              <div className="text-center py-16 border border-zinc-800/50 rounded-2xl text-zinc-500">
                <Library className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Your garage is empty.</p>
                <p className="text-sm mt-1">Evaluate a VIN and hit Save — no login needed.</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {garage.map(v => (
                  <div key={v.id} className="group bg-zinc-900 border border-zinc-800 rounded-2xl p-4 hover:border-zinc-700 transition-colors">
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-8 rounded-lg bg-gradient-to-br from-blue-600/20 to-purple-600/20 border border-zinc-800 flex items-center justify-center">
                        <Car className="w-4 h-4 text-zinc-500" />
                      </div>
                      <button onClick={() => removeFromGarage(v.id)}
                        className="w-7 h-7 rounded-lg hover:bg-red-500/10 flex items-center justify-center text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="font-bold text-[15px]">{v.vehicle.year} {v.vehicle.make} {v.vehicle.model}</p>
                    <p className="text-[12px] text-zinc-500 mt-0.5">{v.vehicle.trim || v.vin}</p>
                    <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between">
                      <span className="text-[16px] font-black text-emerald-400">${v.value.toLocaleString()}</span>
                      <span className="text-[11px] text-zinc-600">{new Date(v.savedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="mt-16 border-t border-zinc-900 py-6 text-center text-[12px] text-zinc-700">
        VINSight · Data from{' '}
        <a href="https://vpic.nhtsa.dot.gov" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-500 transition-colors">NHTSA VPIC</a>
        {' '}&amp;{' '}
        <a href="https://api.nhtsa.gov" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-500 transition-colors">NHTSA Recalls</a>
        {' '}· No tracking · No API keys · No login required
      </footer>
    </div>
  );
}

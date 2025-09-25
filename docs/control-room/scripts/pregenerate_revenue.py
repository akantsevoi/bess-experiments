#!/usr/bin/env python3
import json, os, math, datetime as dt, hashlib

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'static')
os.makedirs(OUT_DIR, exist_ok=True)

def iso(ts):
    return ts.strftime('%Y-%m-%dT%H:%M:%SZ')

def gen_week(start_str, end_str, batteries, price_fn, pred_fn, actual_fn):
    start = dt.datetime.fromisoformat(start_str.replace('Z','+00:00'))
    end = dt.datetime.fromisoformat(end_str.replace('Z','+00:00'))
    price = []
    t = start
    while t < end:
        price.append({
            'ts': iso(t),
            'price_eur_mwh': price_fn(t),
            'interval_min': 15
        })
        t += dt.timedelta(minutes=15)
    pred = pred_fn(start, end, batteries)
    actual = actual_fn(start, end, batteries, pred)
    return {
        'window': {'start': start_str, 'end': end_str},
        'batteries': batteries,
        'price': price,
        'pred': pred,
        'actual': actual,
        'pMinPct': 5,
        'slaPct': 95
    }

# --- Helpers to enforce energy plausibility on actuals ---
def _rebalance_energy(actual_rows, dt_min=5):
    """
    Ensure that, per battery, weekly discharged energy does not exceed charged energy.
    Scales discharge or charge magnitudes down uniformly to match the smaller side.
    """
    from collections import defaultdict
    dt_h = dt_min / 60.0
    totals = defaultdict(lambda: {'chg': 0.0, 'dis': 0.0})
    for r in actual_rows:
        p = float(r.get('power_kw', 0) or 0)
        if r.get('mode') == 'DOWNTIME' or p == 0:
            continue
        e = p * dt_h
        if e > 0:
            totals[r['battery_id']]['dis'] += e
        elif e < 0:
            totals[r['battery_id']]['chg'] += (-e)
    # Compute scale factors
    scale = { bid: {'pos': 1.0, 'neg': 1.0} for bid in totals.keys() }
    for bid, t in totals.items():
        chg, dis = t['chg'], t['dis']
        if dis > chg and dis > 0:
            scale[bid]['pos'] = max(chg / dis, 0.0)
        elif chg > dis and chg > 0:
            scale[bid]['neg'] = max(dis / chg, 0.0)
    if not scale:
        return actual_rows
    # Apply scaling
    out = []
    for r in actual_rows:
        p = float(r.get('power_kw', 0) or 0)
        if r.get('mode') != 'DOWNTIME' and p != 0:
            s = scale.get(r['battery_id'], {'pos':1.0,'neg':1.0})
            if p > 0:
                p = p * s['pos']
            else:
                p = p * s['neg']
            r = dict(r)
            r['power_kw'] = int(round(p))
        out.append(r)
    return out

def write(name, obj):
    path = os.path.join(OUT_DIR, f'revenue-{name}.json')
    with open(path, 'w') as f:
        json.dump(obj, f)
    print('Wrote', path)

START = '2025-09-15T00:00:00Z'
END   = '2025-09-22T00:00:00Z'

# Deterministic pseudo-random helpers (stable across runs)
def rand01(key: str) -> float:
    h = hashlib.sha256(key.encode('utf-8')).digest()
    x = int.from_bytes(h[:8], 'big')
    return x / float(2**64)

def jitter(key: str, scale: float) -> float:
    return (rand01(key) * 2.0 - 1.0) * scale

def hour_jitter(base_hour: int, key: str, max_shift: int = 1) -> int:
    # shift base hour by -max_shift..+max_shift
    shift = int(round(jitter(key, max_shift)))
    return max(0, min(23, base_hour + shift))

# P-001 Hamburg
bat1 = [
    { 'battery_id':'B1', 'capacity_kwh':20000, 'power_kw':5000 },
    { 'battery_id':'B2', 'capacity_kwh':20000, 'power_kw':5000 },
]
def price1(t):
    h = t.hour; dow = t.weekday()
    base=70; peak = 60 if 17<=h<21 else (40 if 8<=h<12 else 0); night=-20 if h<6 else 0; weekend=-10 if dow>=5 else 0
    # add deterministic noise up to +/- 6 EUR/MWh varying by 15-min slot
    p = base+peak+night+weekend
    return max(0, p + jitter(f"P001:{t.isoformat()}", 6.0))
def pred1(start,end,bats):
    pred=[]; d=start
    while d<end:
        yyyy = d.strftime('%Y-%m-%d')
        for b in bats:
            # Vary charge/discharge hours slightly per battery/day
            c_start = hour_jitter(0, f"P001:{b['battery_id']}:{yyyy}:c_start")
            c_len = 5 + int(round(rand01(f"P001:{b['battery_id']}:{yyyy}:c_len")*2))  # 5-7h
            d_start = hour_jitter(17, f"P001:{b['battery_id']}:{yyyy}:d_start")
            d_len = 3 + int(round(rand01(f"P001:{b['battery_id']}:{yyyy}:d_len")))    # 3-4h
            c_pow = int(b['power_kw'] * (0.55 + rand01(f"P001:{b['battery_id']}:{yyyy}:c_pow")*0.15))
            d_pow = int(b['power_kw'] * (0.65 + rand01(f"P001:{b['battery_id']}:{yyyy}:d_pow")*0.15))
            pred.append({ 'battery_id':b['battery_id'], 'start_ts': f'{yyyy}T{c_start:02d}:00:00Z', 'end_ts': f'{yyyy}T{(c_start+c_len)%24:02d}:00:00Z', 'mode':'CHARGE', 'power_kw': -c_pow })
            pred.append({ 'battery_id':b['battery_id'], 'start_ts': f'{yyyy}T{d_start:02d}:00:00Z', 'end_ts': f'{yyyy}T{(d_start+d_len)%24:02d}:00:00Z', 'mode':'DISCHARGE', 'power_kw': d_pow })
        d += dt.timedelta(days=1)
    return pred
def actual1(start,end,bats,pred):
    # helper to check if ts in pred block
    def pred_at(bid, ts):
        for p in pred:
            if p['battery_id']==bid:
                ps = dt.datetime.fromisoformat(p['start_ts'].replace('Z','+00:00'))
                pe = dt.datetime.fromisoformat(p['end_ts'].replace('Z','+00:00'))
                if ps <= ts < pe:
                    return p
        return { 'mode':'IDLE', 'power_kw':0 }
    # make deterministic outage episodes per battery
    outages = {}
    for b in bats:
        episodes = []
        base_key = f"P001:{b['battery_id']}"
        # 1-2 weekly episodes + small daily hiccup at varying minute
        count = 1 + int(rand01(base_key)*2)
        for i in range(count):
            day_off = int(rand01(base_key+f":ep{i}")*7)
            start_min = int(rand01(base_key+f":ep{i}:min")*24*60)
            dur = 20 + int(rand01(base_key+f":ep{i}:dur")*80)
            episodes.append((day_off, start_min, dur))
        outages[b['battery_id']] = episodes
    rows=[]; t=start
    while t<end:
        for b in bats:
            day_idx = (t - start).days
            mins = t.hour*60 + t.minute
            hiccup_min = int(rand01(f"P001:{b['battery_id']}:{t.strftime('%Y-%m-%d')}:hiccup")*60)  # 0-59 past hour 03
            is_hiccup = (t.hour==3 and hiccup_min<=mins<min(hiccup_min+10, 60))
            is_episode = any(day_idx==d and (m<=mins<min(m+dur, 24*60)) for d,m,dur in outages[b['battery_id']])
            if is_hiccup or is_episode:
                rows.append({ 'battery_id':b['battery_id'], 'ts': iso(t), 'mode':'DOWNTIME', 'power_kw':0, 'soc_pct':50 })
                continue
            p = pred_at(b['battery_id'], t)
            mode = p['mode']
            # derate varies smoothly per hour
            derate = 0.9 + jitter(f"P001:{b['battery_id']}:{t.strftime('%Y-%m-%dT%H')}", 0.05)
            power = 0 if mode=='IDLE' else int(round(p['power_kw']*derate))
            rows.append({ 'battery_id':b['battery_id'], 'ts': iso(t), 'mode': mode, 'power_kw': power, 'soc_pct':50 })
        t += dt.timedelta(minutes=5)
    # Rebalance energy per battery to avoid impossible RTE (>100%)
    return _rebalance_energy(rows, dt_min=5)
write('P-001', gen_week(START, END, bat1, price1, pred1, actual1))

# P-002 Stockholm
bat2 = [
    { 'battery_id':'S1', 'capacity_kwh':26000, 'power_kw':6000 },
    { 'battery_id':'S2', 'capacity_kwh':26000, 'power_kw':6000 },
    { 'battery_id':'S3', 'capacity_kwh':26000, 'power_kw':6000 },
]
def price2(t):
    h=t.hour; dow=t.weekday(); base=85; peak=70 if 17<=h<21 else (35 if 8<=h<12 else 0); night=-25 if h<6 else 0; weekend=-12 if dow>=5 else 0
    return max(0, base+peak+night+weekend + jitter(f"P002:{t.isoformat()}", 7.0))
def pred2(start,end,bats):
    bl=[]; d=start
    while d<end:
        yyyy=d.strftime('%Y-%m-%d')
        # Add small per-day offsets and power variance
        bl+= [
            { 'battery_id':'S1', 'start_ts': f'{yyyy}T{hour_jitter(2,f"P002:S1:{yyyy}:c"):02d}:00:00Z', 'end_ts': f'{yyyy}T{hour_jitter(5,f"P002:S1:{yyyy}:c_end"):02d}:00:00Z', 'mode':'CHARGE', 'power_kw': -int(2800 + rand01(f"P002:S1:{yyyy}:cp")*600) },
            { 'battery_id':'S1', 'start_ts': f'{yyyy}T{hour_jitter(16,f"P002:S1:{yyyy}:d"):02d}:00:00Z', 'end_ts': f'{yyyy}T{hour_jitter(22,f"P002:S1:{yyyy}:d_end"):02d}:00:00Z', 'mode':'DISCHARGE', 'power_kw': int(4000 + rand01(f"P002:S1:{yyyy}:dp")*600) },
            { 'battery_id':'S2', 'start_ts': f'{yyyy}T{hour_jitter(0,f"P002:S2:{yyyy}:c"):02d}:00:00Z', 'end_ts': f'{yyyy}T{hour_jitter(6,f"P002:S2:{yyyy}:c_end"):02d}:00:00Z', 'mode':'CHARGE', 'power_kw': -int(3300 + rand01(f"P002:S2:{yyyy}:cp")*500) },
            { 'battery_id':'S2', 'start_ts': f'{yyyy}T{hour_jitter(17,f"P002:S2:{yyyy}:d"):02d}:00:00Z', 'end_ts': f'{yyyy}T{hour_jitter(21,f"P002:S2:{yyyy}:d_end"):02d}:00:00Z', 'mode':'DISCHARGE', 'power_kw': int(3400 + rand01(f"P002:S2:{yyyy}:dp")*500) },
            # Add missing nightly charge for S3 to avoid net discharge only
            { 'battery_id':'S3', 'start_ts': f'{yyyy}T{hour_jitter(1,f"P002:S3:{yyyy}:c"):02d}:00:00Z', 'end_ts': f'{yyyy}T{hour_jitter(3,f"P002:S3:{yyyy}:c_end"):02d}:00:00Z', 'mode':'CHARGE', 'power_kw': -int(2000 + rand01(f"P002:S3:{yyyy}:cp")*400) },
            { 'battery_id':'S3', 'start_ts': f'{yyyy}T{hour_jitter(18,f"P002:S3:{yyyy}:d"):02d}:00:00Z', 'end_ts': f'{yyyy}T{hour_jitter(20,f"P002:S3:{yyyy}:d_end"):02d}:00:00Z', 'mode':'DISCHARGE', 'power_kw': int(2300 + rand01(f"P002:S3:{yyyy}:dp")*500) },
        ]
        d += dt.timedelta(days=1)
    return bl
def actual2(start,end,bats,pred):
    def pred_at(bid, ts):
        for p in pred:
            if p['battery_id']==bid:
                ps = dt.datetime.fromisoformat(p['start_ts'].replace('Z','+00:00'))
                pe = dt.datetime.fromisoformat(p['end_ts'].replace('Z','+00:00'))
                if ps <= ts < pe:
                    return p
        return { 'mode':'IDLE', 'power_kw':0 }
    out=[]; t=start
    # outages: 1-3 weekly episodes, plus daily short 1-8min hiccup at random minute in 01h
    ep_count = 1 + int(rand01('P002:episodes')*3)
    episodes = []
    for i in range(ep_count):
        day_off = int(rand01(f'P002:ep{i}')*7)
        start_min = int(rand01(f'P002:ep{i}:min')*24*60)
        dur = 15 + int(rand01(f'P002:ep{i}:dur')*120)
        episodes.append((day_off, start_min, dur))
    while t<end:
        dow=t.weekday(); mins=t.hour*60+t.minute; day_idx=(t-start).days
        for b in bats:
            hic = int(rand01(f"P002:{b['battery_id']}:{t.strftime('%Y-%m-%d')}:hic")*60)
            ep = any(day_idx==d and (m<=mins<min(m+dur, 24*60)) for d,m,dur in episodes)
            if (mins>=60 and mins<60+ (1+int(rand01(f"P002:{b['battery_id']}:{t.strftime('%Y-%m-%d')}:hiclen")*7))) or (dow==6 and 12*60<=mins<12*60+30) or ep:
                out.append({ 'battery_id':b['battery_id'], 'ts':iso(t), 'mode':'DOWNTIME','power_kw':0,'soc_pct':60 })
            else:
                p=pred_at(b['battery_id'],t); mode=p['mode']; der=0.88 + jitter(f"P002:{b['battery_id']}:{t.strftime('%Y-%m-%dT%H')}", 0.06); power=0 if mode=='IDLE' else int(round(p['power_kw']*der))
                out.append({ 'battery_id':b['battery_id'], 'ts':iso(t), 'mode':mode, 'power_kw':power, 'soc_pct':60 })
        t += dt.timedelta(minutes=5)
    return _rebalance_energy(out, dt_min=5)
write('P-002', gen_week(START, END, bat2, price2, pred2, actual2))

# P-003 Berlin (red)
bat3 = [
    { 'battery_id':'BL1', 'capacity_kwh':30000, 'power_kw':7000 },
    { 'battery_id':'BL2', 'capacity_kwh':30000, 'power_kw':7000 },
    { 'battery_id':'BL3', 'capacity_kwh':30000, 'power_kw':7000 },
    { 'battery_id':'BL4', 'capacity_kwh':15000, 'power_kw':5000 },
    { 'battery_id':'BL5', 'capacity_kwh':15000, 'power_kw':5000 },
]
def price3(t):
    h=t.hour; dow=t.weekday(); base=80; peak=80 if 17<=h<21 else (50 if 8<=h<12 else 0); night=-30 if h<6 else 0; weekend=-15 if dow>=5 else 0
    return max(0, base+peak+night+weekend + jitter(f"P003:{t.isoformat()}", 8.0))
def pred3(start,end,bats):
    bl=[]; d=start
    while d<end:
        yyyy=d.strftime('%Y-%m-%d')
        for b in bats:
            bl.append({ 'battery_id':b['battery_id'], 'start_ts':f'{yyyy}T01:00:00Z', 'end_ts':f'{yyyy}T05:00:00Z', 'mode':'CHARGE', 'power_kw': -int(b['power_kw']*0.5) })
            bl.append({ 'battery_id':b['battery_id'], 'start_ts':f'{yyyy}T17:00:00Z', 'end_ts':f'{yyyy}T22:00:00Z', 'mode':'DISCHARGE', 'power_kw': int(b['power_kw']*0.65) })
        d += dt.timedelta(days=1)
    return bl
def actual3(start,end,bats,pred):
    def pred_at(bid, ts):
        for p in pred:
            if p['battery_id']==bid:
                ps = dt.datetime.fromisoformat(p['start_ts'].replace('Z','+00:00'))
                pe = dt.datetime.fromisoformat(p['end_ts'].replace('Z','+00:00'))
                if ps <= ts < pe:
                    return p
        return { 'mode':'IDLE', 'power_kw':0 }
    rows=[]; t=start
    # more outages: 3-5 episodes per battery
    outages = {}
    for b in bats:
        eps = []
        cnt = 3 + int(rand01('P003:'+b['battery_id'])*3)
        for i in range(cnt):
            day_off = int(rand01(f'P003:{b["battery_id"]}:ep{i}')*7)
            start_min = int(rand01(f'P003:{b["battery_id"]}:ep{i}:min')*24*60)
            dur = 30 + int(rand01(f'P003:{b["battery_id"]}:ep{i}:dur')*180)
            eps.append((day_off, start_min, dur))
        outages[b['battery_id']] = eps
    while t<end:
        dow=t.weekday(); mins=t.hour*60+t.minute; day_idx=(t-start).days
        for b in bats:
            ep = any(day_idx==d and (m<=mins<min(m+dur, 24*60)) for d,m,dur in outages[b['battery_id']])
            if ep or (dow==2 and 2*60<=mins<3*60):
                rows.append({ 'battery_id':b['battery_id'], 'ts':iso(t), 'mode':'DOWNTIME','power_kw':0,'soc_pct':55 })
            else:
                p=pred_at(b['battery_id'],t); mode=p['mode']; der=0.8 + jitter(f"P003:{b['battery_id']}:{t.strftime('%Y-%m-%dT%H')}", 0.08); power=0 if mode=='IDLE' else int(round(p['power_kw']*der))
                rows.append({ 'battery_id':b['battery_id'], 'ts':iso(t), 'mode':mode, 'power_kw':power, 'soc_pct':55 })
        t += dt.timedelta(minutes=5)
    return _rebalance_energy(rows, dt_min=5)
write('P-003', gen_week(START, END, bat3, price3, pred3, actual3))

# P-004 Frankfurt (green)
bat4 = [
    { 'battery_id':'FF1', 'capacity_kwh':15000, 'power_kw':4000 },
    { 'battery_id':'FF2', 'capacity_kwh':15000, 'power_kw':4000 },
]
def price4(t):
    h=t.hour; dow=t.weekday(); base=75; peak=55 if 17<=h<21 else (30 if 8<=h<12 else 0); night=-18 if h<6 else 0; weekend=-8 if dow>=5 else 0
    return max(0, base+peak+night+weekend + jitter(f"P004:{t.isoformat()}", 5.0))
def pred4(start,end,bats):
    bl=[]; d=start
    while d<end:
        yyyy=d.strftime('%Y-%m-%d')
        for b in bats:
            bl.append({ 'battery_id':b['battery_id'], 'start_ts':f'{yyyy}T00:00:00Z', 'end_ts':f'{yyyy}T05:00:00Z', 'mode':'CHARGE', 'power_kw': -int(b['power_kw']*0.55) })
            bl.append({ 'battery_id':b['battery_id'], 'start_ts':f'{yyyy}T17:00:00Z', 'end_ts':f'{yyyy}T20:00:00Z', 'mode':'DISCHARGE', 'power_kw': int(b['power_kw']*0.7) })
        d += dt.timedelta(days=1)
    return bl
def actual4(start,end,bats,pred):
    def pred_at(bid, ts):
        for p in pred:
            if p['battery_id']==bid:
                ps = dt.datetime.fromisoformat(p['start_ts'].replace('Z','+00:00'))
                pe = dt.datetime.fromisoformat(p['end_ts'].replace('Z','+00:00'))
                if ps <= ts < pe:
                    return p
        return { 'mode':'IDLE', 'power_kw':0 }
    rows=[]; t=start
    # minimal outages: 0-1 small per battery + tiny daily hiccup at 04:00 +/- 5m
    outages = {}
    for b in bats:
        eps = []
        cnt = int(rand01('P004:'+b['battery_id'])*2)
        for i in range(cnt):
            day_off = int(rand01(f'P004:{b["battery_id"]}:ep{i}')*7)
            start_min = int(rand01(f'P004:{b["battery_id"]}:ep{i}:min')*24*60)
            dur = 5 + int(rand01(f'P004:{b["battery_id"]}:ep{i}:dur')*20)
            eps.append((day_off, start_min, dur))
        outages[b['battery_id']] = eps
    while t<end:
        mins=t.hour*60+t.minute; day_idx=(t-start).days
        for b in bats:
            hic_start = 4*60 + int(jitter(f"P004:{b['battery_id']}:{t.strftime('%Y-%m-%d')}:hic", 5))
            ep = any(day_idx==d and (m<=mins<min(m+dur, 24*60)) for d,m,dur in outages[b['battery_id']])
            if (hic_start<=mins<hic_start+5) or ep:
                rows.append({ 'battery_id':b['battery_id'], 'ts':iso(t), 'mode':'DOWNTIME','power_kw':0,'soc_pct':65 })
            else:
                p=pred_at(b['battery_id'],t); mode=p['mode']; der=0.95 + jitter(f"P004:{b['battery_id']}:{t.strftime('%Y-%m-%dT%H')}", 0.03); power=0 if mode=='IDLE' else int(round(p['power_kw']*der))
                rows.append({ 'battery_id':b['battery_id'], 'ts':iso(t), 'mode':mode, 'power_kw':power, 'soc_pct':65 })
        t += dt.timedelta(minutes=5)
    return _rebalance_energy(rows, dt_min=5)
write('P-004', gen_week(START, END, bat4, price4, pred4, actual4))

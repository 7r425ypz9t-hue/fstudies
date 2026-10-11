import numpy as np
np.random.seed(7)
# ---------- 1) Cross-impact matrix (researcher judgment, 0-3) ----------
D=["D1 AI gen","D2 Platform/Reco","D3 Public funding","D4 IP & revenue","D5 Evaluation metrics","D6 Institutional autonomy","D7 Social demand for depth","D8 Geopolitics/trade"]
M=np.array([
# D1 D2 D3 D4 D5 D6 D7 D8
 [0, 3, 1, 3, 1, 2, 2, 2], # D1 influences ->
 [1, 0, 1, 2, 1, 2, 3, 1], # D2
 [0, 0, 0, 0, 2, 3, 1, 0], # D3
 [1, 2, 0, 0, 0, 1, 0, 1], # D4
 [0, 0, 3, 0, 0, 3, 1, 0], # D5
 [0, 0, 1, 0, 1, 0, 2, 0], # D6
 [0, 1, 1, 0, 1, 1, 0, 0], # D7
 [2, 2, 1, 2, 0, 0, 0, 0], # D8
])
inf=M.sum(1); dep=M.sum(0)
M2=M@M; inf2=M2.sum(1); dep2=M2.sum(0)
print("Driver | infl dep | indirect infl dep")
for i,d in enumerate(D): print(f"{d:28s} {inf[i]:2d} {dep[i]:2d} | {inf2[i]:3d} {dep2[i]:3d}")
print("total",M.sum())
# robustness: perturb each nonzero cell +-1 (bounded 0..3), 5000 runs, rank stability of top-influence
top=[];quad=[]
for _ in range(5000):
    P=M+np.random.randint(-1,2,M.shape)*(M>0); P=np.clip(P,0,3); np.fill_diagonal(P,0)
    i_=P.sum(1); d_=P.sum(0)
    top.append(tuple(np.argsort(-i_)[:3]))
    quad.append(((i_>i_.mean())&(d_<=d_.mean())))  # driver quadrant
quad=np.array(quad).mean(0)
print("share of runs classified as DRIVER (high infl, low dep):")
for i,d in enumerate(D): print(f"  {d:28s} {quad[i]:.2f}")
# ---------- 2) SD model ----------
def run(m,a=0.10,b=0.12,aut=0.8,c=0.0,delay=8,T=26,dt=0.1,IC0=0.7,EV0=1.0):
    n=int(T/dt); IC=IC0; EV=EV0; hist=[]; buf=[IC0]*int(delay/dt)
    for k in range(n):
        g=0.04+0.04*m
        EV+= g*EV*dt
        obs=buf.pop(0); buf.append(IC)            # policy reacts to delayed observation
        pol=c*max(0,IC0-obs)
        IC+= (a*aut*IC*(1-IC) - b*m*IC + pol)*dt
        IC=min(max(IC,0),1); hist.append((k*dt,EV,IC))
    return np.array(hist)
print("\nm, IC(2050) no-policy aut=0.8 | aut=0.5 | with delayed policy c=0.05 aut=0.8 ; analytic m*=a*aut/b")
for m in [0,0.2,0.4,0.6,0.67,0.8,1.0]:
    r1=run(m)[-1,2]; r2=run(m,aut=0.5)[-1,2]; r3=run(m,c=0.05)[-1,2]
    print(f"{m:.2f}  {r1:.3f}  {r2:.3f}  {r3:.3f}")
print("m* aut=0.8:",0.10*0.8/0.12," m* aut=0.5:",0.10*0.5/0.12)
# equilibrium (long run) to show threshold
print("\nlong-run (T=300) IC equilibrium vs m, aut=0.8:")
for m in np.linspace(0,1,11):
    print(f"  m={m:.1f} IC*={run(m,T=300)[-1,2]:.3f}")
# sensitivity: +-50% on a,b,aut -> share of parameter sets with m* inside (0,1)
S=5000; a=0.10*np.random.uniform(.5,1.5,S); b=0.12*np.random.uniform(.5,1.5,S); au=np.random.uniform(.3,1.0,S)
ms=a*au/b
print("\nshare with threshold m* in (0,1):",(ms<1).mean().round(3)," median m*:",np.median(ms).round(3), " IQR:",np.percentile(ms,[25,75]).round(3))
# discriminator: renewal share proxy R = IC under H-real; constant under H-meas
for m in [0.3,0.8]:
    h=run(m); print(f"H-real m={m}: EV x{h[-1,1]:.2f}, renewal proxy {h[0,2]:.2f}->{h[-1,2]:.2f}; H-meas: EV x{h[-1,1]:.2f}, renewal proxy 0.70->0.70")

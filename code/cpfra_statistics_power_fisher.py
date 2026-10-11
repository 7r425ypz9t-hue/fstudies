import numpy as np
from math import comb
rng=np.random.default_rng(11)
# ---------- A) Content analysis of strategy objectives ----------
# codes: E economic, S social/participation, C creative-intellectual capacity, P place/position
data={
 "UAE CCI Strategy 2021-31":[("GDP 5%","E",None),("global map position","P",None),("inspire creative thinking & attract talents/entrepreneurs","C","E"),
   ("double enterprises","E",None),("new jobs","E",None),("raise income","E",None),("attract freelancers/start-ups","E",None)],
 "Singapore Our SG Arts Plan 2023-27":[("sustain audiences","S",None),("strengthen communities","S",None),("drive advocacy/patrons","S","E"),
   ("diversify spaces","P",None),("activate places","P",None),("infuse arts everywhere","P",None),
   ("new ways of doing business","E",None),("grow artistic excellence","C","E"),("internationalisation/demand","E","P")],
 "Finland Strategy for Cultural Policy 2025":[("conditions for creative work & diverse production","C",None),("inclusion & participation","S",None),("cultural basis strong & vital","C",None)],
}
for k,v in data.items():
    n=len(v)
    base={c:sum(1 for _,a,_ in v if a==c) for c in "ESCP"}
    alt={c:sum(1 for _,a,b in v if (b or a)==c) for c in "ESCP"}
    print(f"{k} (n={n}) base E{base['E']} S{base['S']} C{base['C']} P{base['P']} | alt E{alt['E']} S{alt['S']} C{alt['C']} P{alt['P']}")
# exact test: is UAE economic share > Finland? Fisher exact (one-sided) on E vs non-E
def fisher_one(a,b,c,d):
    # P(X>=a) hypergeometric with row totals a+b, col totals a+c
    n=a+b+c+d; r1=a+b; c1=a+c; p=0
    for x in range(a,min(r1,c1)+1):
        p+=comb(c1,x)*comb(n-c1,r1-x)/comb(n,r1)
    return p
print("Fisher UAE(E5/7) vs Finland(E0/3) one-sided p=",round(fisher_one(5,2,0,3),3))
print("Fisher UAE(E5/7) vs Singapore(E2/9) one-sided p=",round(fisher_one(5,2,2,7),3))
# ---------- B) Power: years of renewal-share data needed to detect decline ----------
def power(slope,sd,years,phi=0.0,sims=4000,alpha=0.05):
    t=np.arange(years); hits=0
    for _ in range(sims):
        e=np.zeros(years); e[0]=rng.normal(0,sd)
        for i in range(1,years): e[i]=phi*e[i-1]+rng.normal(0,sd*np.sqrt(1-phi**2))
        y=0.70+slope*t+e
        X=np.vstack([np.ones(years),t]).T; b,res,_,_=np.linalg.lstsq(X,y,rcond=None)
        r=y-X@b; s2=r@r/(years-2); se=np.sqrt(s2/((t-t.mean())**2).sum())
        # effective n correction for AR(1)
        if phi>0: se*=np.sqrt((1+phi)/(1-phi))
        from math import erf
        tstat=b[1]/se
        if tstat< -1.645: hits+=1
    return hits/sims
for label,slope in [("m=0.3 (slope -0.0042/yr)",-0.0042),("m=0.6 (slope -0.0142/yr)",-0.0142)]:
    for sd in [0.02,0.04]:
        for phi in [0.0,0.5]:
            need=None
            for yrs in range(4,41):
                if power(slope,sd,yrs,phi,sims=1500)>=0.8: need=yrs;break
            print(f"{label} sd={sd} AR={phi}: years for 80% power = {need}")
# ---------- C) Functional-form selection on UNCTAD creative services exports ----------
yrs=np.array([2022,2023,2024]); val=np.array([1.4,1.5,1.7])
print("n=",len(yrs)," -> form selection not identifiable (k params >= n-1 for 2-3 param forms)")

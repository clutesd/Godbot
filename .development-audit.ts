import { Simulation } from './src/sim/Simulation';
for (const abundance of [1, 1.35]) {
 const s = new Simulation({ seed: 'delta-two', startingPopulation:360, society:{conflictRate:2},world:{resourceAbundance:abundance} });
 for(let y=0; y<200; y+=25) { s.step(300); console.log(JSON.stringify({abundance,year:s.year,pop:s.population,institutions:s.state.institutions.length,leaders:s.state.polities.filter(p=>p.leadingPersonId).length,routes:s.state.tradeRoutes.length,trades:s.summary().trades,knowledge:s.state.stats.knowledgeExchanges,war:s.state.stats.wars,tradeEvents:s.state.history.filter(e=>e.type==='knowledge-exchange'&&e.causes.includes('persistent-trade')).length})); }
}

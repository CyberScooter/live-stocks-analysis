/**
 * "Strong buys" by sector.
 *
 * Finnhub's free plan has no market-wide screener, so we keep a fixed list of
 * large companies worldwide per sector and rank them by analyst consensus
 * (/stock/recommendation: how many analysts say strong buy / buy / hold / sell).
 *
 * The scan runs in the background, slowly, so it never eats the whole
 * 60-requests-per-minute allowance, and results are reused for 12 hours
 * (the underlying data only changes about once a month).
 */

// Non-US companies are listed by their US ticker (NYSE/Nasdaq listing, ADR or OTC):
// Finnhub's free plan has no analyst data for foreign exchange tickers like SAP.DE or 7203.T.
const SECTORS = [
  ['Technology', {
    US: [
      ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'Nvidia'], ['AVGO', 'Broadcom'], ['ORCL', 'Oracle'],
      ['CRM', 'Salesforce'], ['ADBE', 'Adobe'], ['AMD', 'AMD'], ['CSCO', 'Cisco'], ['QCOM', 'Qualcomm'],
    ],
    Europe: [
      ['ASML', 'ASML', 'Netherlands'], ['SAP', 'SAP', 'Germany'], ['ARM', 'Arm Holdings', 'UK'], ['NXPI', 'NXP Semiconductors', 'Netherlands'],
      ['IFNNY', 'Infineon', 'Germany'], ['STM', 'STMicroelectronics', 'Switzerland'], ['NOK', 'Nokia', 'Finland'], ['ERIC', 'Ericsson', 'Sweden'],
    ],
    Asia: [
      ['TSM', 'TSMC', 'Taiwan'], ['SSNLF', 'Samsung Electronics', 'South Korea'], ['TOELY', 'Tokyo Electron', 'Japan'], ['INFY', 'Infosys', 'India'],
      ['ATEYY', 'Advantest', 'Japan'], ['XIACY', 'Xiaomi', 'China'], ['KYCCF', 'Keyence', 'Japan'], ['ASX', 'ASE Technology', 'Taiwan'],
    ],
    'Rest of world': [
      ['SHOP', 'Shopify', 'Canada'], ['TEAM', 'Atlassian', 'Australia'], ['CHKP', 'Check Point', 'Israel'], ['MNDY', 'monday.com', 'Israel'],
      ['WIX', 'Wix', 'Israel'], ['NICE', 'NICE', 'Israel'], ['GIB', 'CGI', 'Canada'], ['CNSWF', 'Constellation Software', 'Canada'],
    ],
  }],
  ['Communication', {
    US: [
      ['GOOGL', 'Alphabet'], ['META', 'Meta Platforms'], ['NFLX', 'Netflix'], ['DIS', 'Walt Disney'], ['TMUS', 'T-Mobile US'],
      ['VZ', 'Verizon'], ['T', 'AT&T'], ['CMCSA', 'Comcast'], ['EA', 'Electronic Arts'], ['TTWO', 'Take-Two Interactive'],
    ],
    Europe: [
      ['SPOT', 'Spotify', 'Sweden'], ['DTEGY', 'Deutsche Telekom', 'Germany'], ['ORANY', 'Orange', 'France'], ['VOD', 'Vodafone', 'UK'],
      ['TEF', 'Telefónica', 'Spain'], ['PUBGY', 'Publicis', 'France'], ['WPP', 'WPP', 'UK'], ['PSO', 'Pearson', 'UK'],
    ],
    Asia: [
      ['TCEHY', 'Tencent', 'China'], ['NTES', 'NetEase', 'China'], ['BIDU', 'Baidu', 'China'], ['NTDOY', 'Nintendo', 'Japan'],
      ['SFTBY', 'SoftBank Group', 'Japan'], ['NTTYY', 'NTT', 'Japan'], ['KDDIY', 'KDDI', 'Japan'], ['SKM', 'SK Telecom', 'South Korea'],
    ],
    'Rest of world': [
      ['AMX', 'América Móvil', 'Mexico'], ['BCE', 'BCE', 'Canada'], ['RCI', 'Rogers', 'Canada'], ['TU', 'Telus', 'Canada'],
      ['MTNOY', 'MTN Group', 'South Africa'], ['TIMB', 'TIM Brasil', 'Brazil'], ['VIV', 'Telefônica Brasil', 'Brazil'],
    ],
  }],
  ['Consumer Discretionary', {
    US: [
      ['AMZN', 'Amazon'], ['TSLA', 'Tesla'], ['HD', 'Home Depot'], ['MCD', "McDonald's"], ['NKE', 'Nike'],
      ['SBUX', 'Starbucks'], ['LOW', "Lowe's"], ['BKNG', 'Booking Holdings'], ['TJX', 'TJX Companies'], ['ABNB', 'Airbnb'],
    ],
    Europe: [
      ['LVMUY', 'LVMH', 'France'], ['HESAY', 'Hermès', 'France'], ['IDEXY', 'Inditex (Zara)', 'Spain'], ['RACE', 'Ferrari', 'Italy'],
      ['CFRUY', 'Richemont', 'Switzerland'], ['ADDYY', 'Adidas', 'Germany'], ['MBGYY', 'Mercedes-Benz', 'Germany'], ['STLA', 'Stellantis', 'Netherlands'],
    ],
    Asia: [
      ['BABA', 'Alibaba', 'China'], ['TM', 'Toyota', 'Japan'], ['SONY', 'Sony', 'Japan'], ['PDD', 'PDD Holdings (Temu)', 'China'],
      ['BYDDY', 'BYD', 'China'], ['MPNGY', 'Meituan', 'China'], ['JD', 'JD.com', 'China'], ['SE', 'Sea Limited', 'Singapore'],
      ['FRCOY', 'Fast Retailing (Uniqlo)', 'Japan'], ['TCOM', 'Trip.com', 'China'],
    ],
    'Rest of world': [
      ['MELI', 'MercadoLibre', 'Uruguay'], ['LULU', 'Lululemon', 'Canada'], ['QSR', 'Restaurant Brands', 'Canada'], ['NPSNY', 'Naspers', 'South Africa'],
      ['DLMAF', 'Dollarama', 'Canada'], ['MGA', 'Magna', 'Canada'], ['GLBE', 'Global-e', 'Israel'], ['WFAFY', 'Wesfarmers', 'Australia'],
    ],
  }],
  ['Consumer Staples', {
    US: [
      ['WMT', 'Walmart'], ['COST', 'Costco'], ['PG', 'Procter & Gamble'], ['KO', 'Coca-Cola'], ['PEP', 'PepsiCo'],
      ['PM', 'Philip Morris'], ['MDLZ', 'Mondelez'], ['CL', 'Colgate-Palmolive'], ['MO', 'Altria'], ['TGT', 'Target'],
    ],
    Europe: [
      ['NSRGY', 'Nestlé', 'Switzerland'], ['UL', 'Unilever', 'UK'], ['LRLCY', "L'Oréal", 'France'], ['DEO', 'Diageo', 'UK'],
      ['BUD', 'AB InBev', 'Belgium'], ['BTI', 'British American Tobacco', 'UK'], ['DANOY', 'Danone', 'France'], ['HEINY', 'Heineken', 'Netherlands'],
    ],
    Asia: [
      ['JAPAY', 'Japan Tobacco', 'Japan'], ['SVNDY', 'Seven & i', 'Japan'], ['KAOOY', 'Kao', 'Japan'], ['AJINY', 'Ajinomoto', 'Japan'],
      ['CIADY', 'China Mengniu Dairy', 'China'], ['KNBWY', 'Kirin', 'Japan'],
    ],
    'Rest of world': [
      ['FMX', 'Femsa', 'Mexico'], ['KOF', 'Coca-Cola Femsa', 'Mexico'], ['WMMVY', 'Walmart de México', 'Mexico'], ['ANCTF', 'Alimentation Couche-Tard', 'Canada'],
      ['LBLCF', 'Loblaw', 'Canada'], ['ABEV', 'Ambev', 'Brazil'], ['WOLWF', 'Woolworths Group', 'Australia'],
    ],
  }],
  ['Healthcare', {
    US: [
      ['LLY', 'Eli Lilly'], ['UNH', 'UnitedHealth'], ['JNJ', 'Johnson & Johnson'], ['ABBV', 'AbbVie'], ['MRK', 'Merck'],
      ['TMO', 'Thermo Fisher'], ['ABT', 'Abbott'], ['PFE', 'Pfizer'], ['AMGN', 'Amgen'], ['ISRG', 'Intuitive Surgical'],
    ],
    Europe: [
      ['NVO', 'Novo Nordisk', 'Denmark'], ['AZN', 'AstraZeneca', 'UK'], ['NVS', 'Novartis', 'Switzerland'], ['RHHBY', 'Roche', 'Switzerland'],
      ['SNY', 'Sanofi', 'France'], ['GSK', 'GSK', 'UK'], ['ESLOY', 'EssilorLuxottica', 'France'], ['PHG', 'Philips', 'Netherlands'],
    ],
    Asia: [
      ['TAK', 'Takeda', 'Japan'], ['DSNKY', 'Daiichi Sankyo', 'Japan'], ['CHGCY', 'Chugai Pharmaceutical', 'Japan'], ['HOCPY', 'Hoya', 'Japan'],
      ['OTSKY', 'Otsuka', 'Japan'], ['TRUMY', 'Terumo', 'Japan'], ['ALPMY', 'Astellas', 'Japan'], ['RDY', "Dr. Reddy's", 'India'],
    ],
    'Rest of world': [
      ['CSLLY', 'CSL', 'Australia'], ['TEVA', 'Teva', 'Israel'],
    ],
  }],
  ['Financials', {
    US: [
      ['JPM', 'JPMorgan Chase'], ['V', 'Visa'], ['MA', 'Mastercard'], ['BAC', 'Bank of America'], ['WFC', 'Wells Fargo'],
      ['GS', 'Goldman Sachs'], ['MS', 'Morgan Stanley'], ['BLK', 'BlackRock'], ['AXP', 'American Express'], ['C', 'Citigroup'],
    ],
    Europe: [
      ['HSBC', 'HSBC', 'UK'], ['ALIZY', 'Allianz', 'Germany'], ['UBS', 'UBS', 'Switzerland'], ['SAN', 'Banco Santander', 'Spain'],
      ['BNPQY', 'BNP Paribas', 'France'], ['AXAHY', 'AXA', 'France'], ['UNCRY', 'UniCredit', 'Italy'], ['ING', 'ING', 'Netherlands'],
      ['BBVA', 'BBVA', 'Spain'], ['BCS', 'Barclays', 'UK'], ['ADYEY', 'Adyen', 'Netherlands'],
    ],
    Asia: [
      ['HDB', 'HDFC Bank', 'India'], ['IBN', 'ICICI Bank', 'India'], ['MUFG', 'Mitsubishi UFJ', 'Japan'], ['SMFG', 'Sumitomo Mitsui', 'Japan'],
      ['AAGIY', 'AIA Group', 'Hong Kong'], ['PNGAY', 'Ping An', 'China'], ['DBSDY', 'DBS Group', 'Singapore'], ['KB', 'KB Financial', 'South Korea'],
      ['MFG', 'Mizuho', 'Japan'], ['TKOMY', 'Tokio Marine', 'Japan'],
    ],
    'Rest of world': [
      ['RY', 'Royal Bank of Canada', 'Canada'], ['TD', 'TD Bank', 'Canada'], ['NU', 'Nubank', 'Brazil'], ['ITUB', 'Itaú Unibanco', 'Brazil'],
      ['BN', 'Brookfield', 'Canada'], ['BMO', 'Bank of Montreal', 'Canada'], ['MFC', 'Manulife', 'Canada'], ['CMWAY', 'Commonwealth Bank', 'Australia'],
      ['MQBKY', 'Macquarie', 'Australia'], ['BAP', 'Credicorp', 'Peru'],
    ],
  }],
  ['Industrials', {
    US: [
      ['GE', 'GE Aerospace'], ['CAT', 'Caterpillar'], ['RTX', 'RTX'], ['UNP', 'Union Pacific'], ['HON', 'Honeywell'],
      ['BA', 'Boeing'], ['DE', 'Deere'], ['LMT', 'Lockheed Martin'], ['UPS', 'UPS'], ['UBER', 'Uber'],
    ],
    Europe: [
      ['SIEGY', 'Siemens', 'Germany'], ['SBGSY', 'Schneider Electric', 'France'], ['EADSY', 'Airbus', 'Netherlands'], ['ABBNY', 'ABB', 'Switzerland'],
      ['RELX', 'RELX', 'UK'], ['SAFRY', 'Safran', 'France'], ['RYCEY', 'Rolls-Royce', 'UK'], ['BAESY', 'BAE Systems', 'UK'],
    ],
    Asia: [
      ['HTHIY', 'Hitachi', 'Japan'], ['MHVYF', 'Mitsubishi Heavy Industries', 'Japan'], ['ITOCY', 'Itochu', 'Japan'], ['MITSY', 'Mitsui & Co', 'Japan'],
      ['MSBHF', 'Mitsubishi Corp', 'Japan'], ['FANUY', 'Fanuc', 'Japan'], ['SMCAY', 'SMC', 'Japan'], ['DKILY', 'Daikin', 'Japan'],
    ],
    'Rest of world': [
      ['CP', 'Canadian Pacific Kansas City', 'Canada'], ['CNI', 'Canadian National Railway', 'Canada'], ['WCN', 'Waste Connections', 'Canada'], ['TRI', 'Thomson Reuters', 'Canada'],
      ['ERJ', 'Embraer', 'Brazil'], ['ESLT', 'Elbit Systems', 'Israel'], ['RBA', 'RB Global', 'Canada'],
    ],
  }],
  ['Energy', {
    US: [
      ['XOM', 'Exxon Mobil'], ['CVX', 'Chevron'], ['COP', 'ConocoPhillips'], ['SLB', 'SLB'], ['EOG', 'EOG Resources'],
      ['MPC', 'Marathon Petroleum'], ['PSX', 'Phillips 66'], ['OXY', 'Occidental'], ['WMB', 'Williams'], ['KMI', 'Kinder Morgan'],
    ],
    Europe: [
      ['SHEL', 'Shell', 'UK'], ['TTE', 'TotalEnergies', 'France'], ['BP', 'BP', 'UK'], ['EQNR', 'Equinor', 'Norway'], ['E', 'Eni', 'Italy'],
    ],
    Asia: [
      ['RLNIY', 'Reliance Industries', 'India'], ['PCCYF', 'PetroChina', 'China'], ['IPXHY', 'Inpex', 'Japan'], ['JXHLY', 'ENEOS', 'Japan'],
    ],
    'Rest of world': [
      ['ENB', 'Enbridge', 'Canada'], ['CNQ', 'Canadian Natural Resources', 'Canada'], ['SU', 'Suncor', 'Canada'], ['TRP', 'TC Energy', 'Canada'],
      ['CVE', 'Cenovus', 'Canada'], ['PBR', 'Petrobras', 'Brazil'], ['WDS', 'Woodside', 'Australia'], ['CCJ', 'Cameco', 'Canada'],
      ['SSL', 'Sasol', 'South Africa'],
    ],
  }],
  ['Utilities', {
    US: [
      ['NEE', 'NextEra Energy'], ['SO', 'Southern Company'], ['DUK', 'Duke Energy'], ['CEG', 'Constellation Energy'], ['AEP', 'American Electric Power'],
      ['D', 'Dominion Energy'], ['SRE', 'Sempra'], ['EXC', 'Exelon'], ['XEL', 'Xcel Energy'], ['VST', 'Vistra'],
    ],
    Europe: [
      ['IBDRY', 'Iberdrola', 'Spain'], ['ENLAY', 'Enel', 'Italy'], ['NGG', 'National Grid', 'UK'], ['EONGY', 'E.ON', 'Germany'],
      ['RWEOY', 'RWE', 'Germany'], ['SSEZY', 'SSE', 'UK'],
    ],
    Asia: [
      ['KEP', 'Korea Electric Power', 'South Korea'], ['CLPHY', 'CLP Holdings', 'Hong Kong'], ['HOKCY', 'Hong Kong & China Gas', 'Hong Kong'], ['TKGSY', 'Tokyo Gas', 'Japan'],
    ],
    'Rest of world': [
      ['FTS', 'Fortis', 'Canada'], ['BEP', 'Brookfield Renewable', 'Canada'], ['BIP', 'Brookfield Infrastructure', 'Canada'], ['SBS', 'Sabesp', 'Brazil'],
      ['ELP', 'Copel', 'Brazil'], ['EMRAF', 'Emera', 'Canada'], ['CIG', 'Cemig', 'Brazil'],
    ],
  }],
  ['Real Estate', {
    US: [
      ['PLD', 'Prologis'], ['AMT', 'American Tower'], ['EQIX', 'Equinix'], ['WELL', 'Welltower'], ['SPG', 'Simon Property'],
      ['O', 'Realty Income'], ['PSA', 'Public Storage'], ['DLR', 'Digital Realty'], ['CCI', 'Crown Castle'], ['CBRE', 'CBRE Group'],
    ],
    Europe: [['VONOY', 'Vonovia', 'Germany'], ['SEGXF', 'Segro', 'UK']],
    Asia: [
      ['MTSFY', 'Mitsui Fudosan', 'Japan'], ['MITEY', 'Mitsubishi Estate', 'Japan'], ['SUHJY', 'Sun Hung Kai Properties', 'Hong Kong'], ['BEKE', 'KE Holdings', 'China'],
      ['CAOVY', 'China Overseas Land', 'China'], ['LKREF', 'Link REIT', 'Hong Kong'],
    ],
    'Rest of world': [
      ['GMGSF', 'Goodman Group', 'Australia'], ['FSV', 'FirstService', 'Canada'], ['CIGI', 'Colliers', 'Canada'],
    ],
  }],
  ['Materials', {
    US: [
      ['LIN', 'Linde'], ['SHW', 'Sherwin-Williams'], ['APD', 'Air Products'], ['ECL', 'Ecolab'], ['FCX', 'Freeport-McMoRan'],
      ['NEM', 'Newmont'], ['DOW', 'Dow'], ['NUE', 'Nucor'], ['CTVA', 'Corteva'], ['VMC', 'Vulcan Materials'],
    ],
    Europe: [
      ['AIQUY', 'Air Liquide', 'France'], ['RIO', 'Rio Tinto', 'UK'], ['GLNCY', 'Glencore', 'Switzerland'], ['CRH', 'CRH', 'Ireland'],
      ['HCMLY', 'Holcim', 'Switzerland'], ['NGLOY', 'Anglo American', 'UK'], ['BASFY', 'BASF', 'Germany'], ['SXYAY', 'Sika', 'Switzerland'],
    ],
    Asia: [
      ['SHECY', 'Shin-Etsu Chemical', 'Japan'], ['PKX', 'POSCO', 'South Korea'], ['NPSCY', 'Nippon Steel', 'Japan'], ['ZIJMY', 'Zijin Mining', 'China'],
    ],
    'Rest of world': [
      ['BHP', 'BHP', 'Australia'], ['VALE', 'Vale', 'Brazil'], ['NTR', 'Nutrien', 'Canada'], ['AEM', 'Agnico Eagle', 'Canada'],
      ['B', 'Barrick Mining', 'Canada'], ['WPM', 'Wheaton Precious Metals', 'Canada'], ['FNV', 'Franco-Nevada', 'Canada'], ['TECK', 'Teck Resources', 'Canada'],
      ['CX', 'Cemex', 'Mexico'], ['GFI', 'Gold Fields', 'South Africa'],
    ],
  }],
].map(([name, regions]) => ({
  name,
  stocks: Object.entries(regions).flatMap(([region, list]) =>
    list.map(([symbol, company, country]) => ({ symbol, name: company, sector: name, region, country: country || 'US' }))
  ),
}));

const REGIONS = ['US', 'Europe', 'Asia', 'Rest of world'];
// Scan order: all US stocks first, then Europe, Asia and the rest, so the tab fills in region by region.
const ALL = SECTORS.flatMap((s) => s.stocks).sort((x, y) => REGIONS.indexOf(x.region) - REGIONS.indexOf(y.region));

const RESULT_TTL_MS = 12 * 60 * 60e3;
const GAP_MS = 1500; // ~40 requests/min, leaving room for normal browsing
const MIN_ANALYSTS = 5; // a "consensus" of two people isn't one

const WEIGHTS = { strongBuy: 5, buy: 4, hold: 3, sell: 2, strongSell: 1 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function scoreOf(rec) {
  const total = Object.keys(WEIGHTS).reduce((s, k) => s + (rec[k] || 0), 0);
  if (!total) return null;
  const score = Object.entries(WEIGHTS).reduce((s, [k, w]) => s + (rec[k] || 0) * w, 0) / total;
  return { total, score };
}

// Same thresholds as the consensus label on the stock page.
const labelOf = (score) =>
  score >= 4.2 ? 'Strong buy' : score >= 3.5 ? 'Buy' : score >= 2.5 ? 'Hold' : score >= 1.8 ? 'Sell' : 'Strong sell';

function summarise(recs) {
  if (!Array.isArray(recs) || !recs.length) return null;
  const sorted = [...recs].sort((a, b) => String(b.period).localeCompare(String(a.period)));
  const latest = sorted[0];
  const now = scoreOf(latest);
  if (!now || now.total < MIN_ANALYSTS) return null;
  const before = sorted[1] ? scoreOf(sorted[1]) : null;
  return {
    period: latest.period,
    analysts: now.total,
    score: Math.round(now.score * 100) / 100,
    label: labelOf(now.score),
    buyPct: Math.round((((latest.strongBuy || 0) + (latest.buy || 0)) / now.total) * 100),
    counts: Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, latest[k] || 0])),
    // Change in score vs the previous month: positive = analysts getting more bullish
    trend: before ? Math.round((now.score - before.score) * 100) / 100 : 0,
  };
}

export function createTopRated({ finnhub, cached }) {
  const state = { results: new Map(), scanning: false, done: 0, finishedAt: 0, error: null };

  async function scan() {
    if (state.scanning) return;
    state.scanning = true;
    state.done = 0;
    state.error = null;
    try {
      for (const stock of ALL) {
        let fetched = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const recs = await cached(`fh:rec:${stock.symbol}`, RESULT_TTL_MS, () => {
              fetched = true;
              return finnhub('/stock/recommendation', { symbol: stock.symbol });
            });
            const summary = summarise(recs);
            if (summary) state.results.set(stock.symbol, { ...stock, ...summary });
            else state.results.delete(stock.symbol);
            break;
          } catch (err) {
            // Bad or missing API key: no point continuing.
            if (err.status === 401 || err.status === 500) {
              state.error = err.message;
              return;
            }
            if (err.status === 429 && attempt < 2) {
              await sleep(30_000);
              continue;
            }
            break; // skip this stock, keep any earlier result
          }
        }
        state.done += 1;
        if (fetched) await sleep(GAP_MS);
      }
      state.finishedAt = Date.now();
    } finally {
      state.scanning = false;
    }
  }

  return function handler(_req, res) {
    const stale = !state.finishedAt || Date.now() - state.finishedAt > RESULT_TTL_MS;
    if (stale && !state.scanning) scan().catch((err) => (state.error = err.message));

    res.json({
      scanning: state.scanning,
      done: state.scanning ? state.done : state.finishedAt ? ALL.length : state.done,
      total: ALL.length,
      updatedAt: state.finishedAt || null,
      error: state.error,
      sectors: SECTORS.map((s) => ({
        name: s.name,
        stocks: s.stocks
          .map((st) => state.results.get(st.symbol))
          .filter(Boolean)
          .sort((a, b) => b.score - a.score || b.analysts - a.analysts),
      })),
    });
  };
}

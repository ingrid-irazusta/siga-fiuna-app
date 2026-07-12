const normText = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
const isPlaceholderReq = (reqNorm) => reqNorm.startsWith('SEGUN ') || reqNorm === 'SEGUN REGLAMENTO' || reqNorm === 'SEGUN OPTATIVA';

const variants = [
  'Contabilidad y Finanzas',
  'Regular del 5to Semestre',
  'Regular del 5° Semestre',
  'Regular del 5º Semestre',
  'Regular del 5to  Semestre',
  'Regular del 5to\nSemestre',
  'Regular del 5TO Semestre',
  'Regular del 5to semestre'
];

const normalized = variants.map(v => ({ raw: v, key: normText(v) }));
console.log('NORMALIZACIÓN DEL STRING:');
normalized.forEach((item) => console.log(JSON.stringify(item)));
console.log('\nIGUALDADES:');
for (let i = 0; i < normalized.length; i++) {
  for (let j = i + 1; j < normalized.length; j++) {
    if (normalized[i].key === normalized[j].key) {
      console.log(`${normalized[i].raw} == ${normalized[j].raw} -> ${normalized[i].key}`);
    }
  }
}

const itemKeys = [
  normText('Contabilidad y Finanzas'),
  normText('Regular del 5to Semestre'),
  normText('Regular del 5° Semestre'),
  normText('Regular del 5º Semestre'),
  normText('Regular del 5to  Semestre'),
  normText('Regular del 5to\nSemestre')
];
const requirement = normText('Regular del 5to Semestre');
console.log('\nREQUISITO EXACTO:', JSON.stringify(requirement));
console.log('itemByKey.has(requirement) para cada key:');
itemKeys.forEach(k => console.log(JSON.stringify(k), k === requirement));
const similar = Array.from(new Set(itemKeys.filter(k => k.includes('REGULAR DEL 5'))));
console.log('\nSimilar keys:', JSON.stringify(similar));

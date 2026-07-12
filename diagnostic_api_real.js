const base = 'https://script.google.com/macros/s/AKfycbwpH_3jUNP2Im_7YImLwJeUo_5gE9hzOX4KVEA3qACN2cWMEp-BOTet1QBEae1ejMloxA/exec';
const carrera = 'Ingeniería Geográfica y Ambiental';
const plan = '2023';
const url = `${base}?carrera=${encodeURIComponent(carrera)}&plan=${encodeURIComponent(plan)}`;
const normalize = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
const parseReqs = (req) => {
  if (Array.isArray(req)) return req.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (typeof req === 'string') return req.split(/[\n;]+|,(?![^\[]*\])/g).map((x) => String(x ?? '').trim()).filter(Boolean);
  return [];
};

(async () => {
  console.log('Fetching', url);
  const resp = await fetch(url, { method: 'GET' });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error('JSON parse error', e);
    console.log(text.slice(0, 1000));
    process.exit(1);
  }
  console.log('status', resp.status, 'ok', data.ok);
  if (!data.ok) {
    console.error('Error payload', data);
    process.exit(1);
  }
  const all = Array.isArray(data.materias) ? data.materias : [];
  console.log('total materias', all.length);

  const find = (matcher) => all.filter((m) => matcher(String(m.materia || '')));
  const contabilidad = find((m) => String(m).trim().toLowerCase() === 'contabilidad y finanzas');
  const regular5 = find((m) => /regular.*5/.test(String(m).toLowerCase()));

  const printItem = (item) => {
    const materia = String(item.materia || '');
    const reqArr = parseReqs(item.requisitos);
    const reqKeys = reqArr.map((r) => normalize(r));
    console.log('---');
    console.log('materia:', materia);
    console.log('semestre:', item.semestre);
    console.log('key norm:', normalize(materia));
    console.log('requisitos original:', JSON.stringify(reqArr));
    console.log('requisitosKeys:', JSON.stringify(reqKeys));
  };

  console.log('\n=== CONTABILIDAD Y FINANZAS ===');
  if (!contabilidad.length) {
    console.log('No encontrada');
  } else {
    contabilidad.forEach(printItem);
  }

  console.log('\n=== FILAS REGULAR CON 5 ===');
  if (!regular5.length) {
    console.log('No encontrado');
  } else {
    regular5.forEach(printItem);
  }

  const contReqKeys = contabilidad.flatMap((item) => {
    const reqArr = parseReqs(item.requisitos);
    return reqArr.map((r) => normalize(r));
  });
  console.log('\nCONTABILIDAD requisitosKeys exactos:', JSON.stringify(contReqKeys));

  const allKeys = all.map((item) => ({ materia: item.materia, key: normalize(item.materia), semestre: item.semestre }));
  for (const reqKey of contReqKeys) {
    const matches = allKeys.filter(({ key }) => key === reqKey);
    console.log('\nREQ KEY:', reqKey, 'matches', matches.length);
    matches.forEach((m) => console.log('  match:', m));
  }

  if (regular5.length) {
    console.log('\n=== requisitos internos de cada Regular 5 ===');
    regular5.forEach((item) => {
      const reqArr = parseReqs(item.requisitos);
      console.log(item.materia, '->', JSON.stringify(reqArr));
    });
  }
})();

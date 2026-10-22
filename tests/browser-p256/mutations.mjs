import assert from 'node:assert/strict';
const model='Foundation.Crypto.P256.Model',wire='Foundation.Crypto.P256.Wire';
export const mutations=Object.freeze([
  ['point-length','p256PublicKeyValid','ValidPoint1'],
  ['point-prefix','p256PublicKeyValid','ValidPoint1'],
  ['field-range','p256FieldValid','LimbsP'],
  ['field-length','p256FieldValid','LimbsZero'],
  ['limb-range','p256LimbListValid','LimbValue0_65536'],
  ['modulus','p256Modulus','LimbsMax'],
  ['curve-b','p256CurveB','ValidPoint1'],
  ['addition-carry','p256AddDigits','Field4_1_1'],
  ['subtraction-borrow','p256SubtractDigits','Field1_1_2'],
  ['sum-reduction','p256ReduceSum','Field7_1_1'],
  ['subtraction-order','p256FieldSubtract','Field1_2_2'],
  ['factor-advance','p256MultiplyStep','Field2_2_3'],
  ['right-half','p256MultiplyTree','Field1_1_3'],
  ['bit-index','p256MultiplyStep','Field9_9_3'],
  ['bit-value','p256MultiplyStep','Field3_3_3'],
  ['coordinate-endian','p256DecodeDigits','Field1_0_1'],
  ['output-endian','p256EncodeDigits','Field1_0_1'],
  ['curve-sign','p256PointCoordinatesValid','ValidPoint1'],
  ['y-square','p256PointCoordinatesValid','ValidPoint1'],
  ['trailing-input','p256PointRequest','Trailing',wire],
  ['frame-limit','p256WireBytes','FrameOverflow',wire],
  ['request-version','p256ReadRequest','Version',wire],
].map(([id,definition,probe,module=model])=>Object.freeze({id,definition,probe,module})));
export const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export function mutateP256Source(sources,id){
  const selected=mutations.find(row=>row.id===id);assert.ok(selected,'registered P256 mutation');
  const original=sources.get(selected.module),text=original.toString('utf8');
  const data=JSON.parse(/\\semanticdata\{(.*)\}/.exec(text)[1]);
  const declaration=data.declarations.find(row=>row.name===selected.definition);assert.ok(declaration);
  let count=0;
  const literal=(node,value)=>node?.kind==='nat'&&node.value===String(value);
  const isVar=(node,name)=>node?.kind==='var'&&node.name===name;
  const visit=node=>{
    if(!node||typeof node!=='object')return;
    const set=value=>{Object.keys(node).forEach(key=>delete node[key]);Object.assign(node,value);count++;};
    if(id==='point-length'&&node.kind==='beq'&&literal(node.right,65)){node.right.value='64';count++;return;}
    if(id==='point-prefix'&&node.kind==='beq'&&literal(node.right,4)){node.right.value='5';count++;return;}
    if(id==='field-range'&&node.kind==='beq'&&node.left.kind==='call'&&node.left.function.name==='p256DigitsOrder'){
      node.kind='ble';count++;return;
    }
    if(id==='field-length'&&node.kind==='beq'&&literal(node.right,17)){node.right.value='16';count++;return;}
    if(id==='limb-range'&&node.kind==='blt'&&literal(node.right,65536)){node.right.value='65537';count++;return;}
    if(id==='addition-carry'&&node.kind==='primitive'&&node.operation==='quotient'&&literal(node.arguments[1],65536)){
      node.arguments[1].value='65537';count++;return;
    }
    if(id==='subtraction-borrow'&&node.kind==='ble'&&isVar(node.right,'head')){node.kind='blt';count++;return;}
    if(id==='sum-reduction'&&node.kind==='beq'&&node.left.kind==='call'&&node.left.function.name==='p256DigitsOrder'){
      node.kind='ble';count++;return;
    }
    if(id==='subtraction-order'&&node.kind==='beq'&&node.left.kind==='call'&&node.left.function.name==='p256DigitsOrder'){
      node.right.value='2';count++;return;
    }
    if(id==='factor-advance'&&node.kind==='call'&&node.function.name==='p256FieldAdd'
      &&node.arguments.every(arg=>arg.kind==='project'&&arg.field==='factor')){
      node.arguments[1]={kind:'call',function:{name:'p256Zero'},arguments:[]};count++;return;
    }
    if(id==='right-half'&&node.kind==='call'&&node.function.name==='p256MultiplyTree'&&isVar(node.arguments[1],'leftState')){
      // Lose the left half's accumulated result, not the structural recursion
      // argument. A termination/type error is not a semantic counterexample.
      assert.ok(isVar(node.arguments[2],'prior'));
      node.arguments[1]={kind:'record',type:{name:'P256MultiplyState'},fields:[
        {field:'accumulator',value:{kind:'project',field:'accumulator',value:{kind:'var',name:'current'}}},
        {field:'factor',value:{kind:'project',field:'factor',value:{kind:'var',name:'leftState'}}},
        {field:'index',value:{kind:'project',field:'index',value:{kind:'var',name:'leftState'}}},
      ]};count++;return;
    }
    if(id==='bit-index'&&node.kind==='primitive'&&node.operation==='quotient'&&literal(node.arguments[1],16)){
      node.arguments[1].value='15';count++;return;
    }
    if(id==='bit-value'&&node.kind==='primitive'&&node.operation==='remainder'&&literal(node.arguments[1],2)){
      node.arguments[1].value='3';count++;return;
    }
    if(id==='coordinate-endian'&&node.kind==='call'&&node.function.name==='cborOctetNat'){
      if(isVar(node.arguments[0],'high')){node.arguments[0].name='low';count++;return;}
      if(isVar(node.arguments[0],'low')){node.arguments[0].name='high';count++;return;}
    }
    if(id==='output-endian'&&node.kind==='call'&&node.function.name==='cborOctetBytes'){
      const operand=node.arguments[0];assert.equal(operand.kind,'primitive');
      operand.operation=operand.operation==='quotient'?'remainder':'quotient';count++;return;
    }
    if(id==='curve-sign'&&node.kind==='call'&&node.function.name==='p256FieldSubtract'){
      node.function.name='p256FieldAdd';count++;return;
    }
    if(id==='y-square'&&node.kind==='call'&&node.function.name==='p256FieldMultiply'
      &&node.arguments.every(arg=>isVar(arg,'y'))){node.arguments[1].name='x';count++;return;}
    if(id==='trailing-input'&&node.kind==='beq'&&node.left.kind==='project'&&node.left.field==='cursor'){
      set({kind:'bool',value:true});return;
    }
    if(id==='frame-limit'&&node.kind==='ble'&&literal(node.right,512)){node.right.value='1024';count++;return;}
    if(id==='request-version'&&node.kind==='beq'&&node.left.kind==='project'&&isVar(node.left.value,'version')){
      set({kind:'bool',value:true});return;
    }
    Object.values(node).forEach(value=>Array.isArray(value)?value.forEach(visit):visit(value));
  };
  if(id==='modulus'||id==='curve-b'){
    const first=declaration.body.arguments[0];assert.equal(first.kind,'nat');
    first.value=String(Number(first.value)+(id==='modulus'?-1:1));count++;
  }else visit(declaration.body);
  assert.equal(count,['coordinate-endian','output-endian'].includes(id)?2:1,'exact source defect '+id);
  const changed=Buffer.from(text.replace(/\\semanticdata\{.*\}/,'\\semanticdata{'+JSON.stringify(canonical(data))+'}'));
  assert.notDeepEqual(changed,original);sources.set(selected.module,changed);return selected;
}

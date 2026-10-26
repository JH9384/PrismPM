use super::*;
use serde_json::json;

fn alias(owner: &str, name: &str) -> Value {
    json!({"kind":"call","function":{"module":owner,"name":name},"arguments":[]})
}

fn closed(body: Value) -> Value {
    json!({"kind":"definition","parameters":[],"result":{"kind":"string"},"body":body})
}

#[test]
fn cyclic_metadata_aliases_are_typed_failures() {
    let self_cycle = closed(alias("First", "self"));
    let first = closed(alias("Second", "next"));
    let second = closed(alias("First", "next"));
    let definitions = BTreeMap::from([
        (("First".to_owned(), "self".to_owned()), &self_cycle),
        (("First".to_owned(), "next".to_owned()), &first),
        (("Second".to_owned(), "next".to_owned()), &second),
    ]);
    for request in [alias("First", "self"), alias("First", "next")] {
        assert_eq!(
            evaluated(&definitions, "First", &request).unwrap_err().code,
            "PP2001"
        );
    }
    let record = json!({"kind":"record","fields":[{"field":"name","value":alias("First","self")}]});
    assert_eq!(
        record_with_unevaluated_fields(&definitions, "First", &record, &[])
            .unwrap_err()
            .code,
        "PP2001"
    );
    // Native root lists have their own bounded walker and must stay deferred.
    assert_eq!(
        record_with_unevaluated_fields(&definitions, "First", &record, &["name"]).unwrap()["name"]
            .1,
        &record["fields"][0]["value"]
    );
}

#[test]
fn malformed_alias_owners_never_fall_back_to_the_current_module() {
    let declaration = closed(json!({"kind":"string","value":"valid"}));
    let definitions = BTreeMap::from([(("Here".to_owned(), "value".to_owned()), &declaration)]);
    for owner in [Value::Null, json!(false), json!(7), json!([]), json!({})] {
        let mut request = alias("Here", "value");
        request["function"]["module"] = owner;
        assert_eq!(
            evaluated(&definitions, "Here", &request).unwrap_err().code,
            "PP2001"
        );
    }
    for request in [
        json!({"kind":"call","function":{"name":"value"},"arguments":[{"kind":"string","value":"extra"}]}),
        json!({"kind":"call","function":{"name":"value"},"arguments":null}),
        json!({"kind":"call","function":{"name":7},"arguments":[]}),
        alias("Missing", "value"),
    ] {
        assert_eq!(
            evaluated(&definitions, "Here", &request).unwrap_err().code,
            "PP2001"
        );
    }
}

#[test]
fn aliases_preserve_module_context_and_repeated_independent_fields() {
    let here = closed(json!({"kind":"string","value":"wrong module"}));
    let other = closed(json!({"kind":"string","value":"right module"}));
    let first = closed(json!({"kind":"call","function":{"name":"value"},"arguments":[]}));
    let definitions = BTreeMap::from([
        (("Here".to_owned(), "value".to_owned()), &here),
        (("Other".to_owned(), "value".to_owned()), &other),
        (("Other".to_owned(), "first".to_owned()), &first),
    ]);
    let request = alias("Other", "first");
    let (owner, result) = evaluated(&definitions, "Here", &request).unwrap();
    assert_eq!(owner, "Other");
    assert_eq!(result, &other["body"]);
    let record = json!({"kind":"record","fields":[
        {"field":"name","value":request.clone()},
        {"field":"description","value":request}
    ]});
    let fields = record_with_unevaluated_fields(&definitions, "Here", &record, &[]).unwrap();
    assert_eq!(fields["name"], fields["description"]);
    assert_eq!(fields["name"], ("Other", &other["body"]));
}

#[test]
fn metadata_alias_budget_has_an_exact_iterative_boundary() {
    const LIMIT: usize = 65_536;
    let declarations = (0..=LIMIT)
        .map(|index| {
            if index == LIMIT {
                closed(json!({"kind":"string","value":"leaf"}))
            } else {
                closed(alias("Chain", &format!("item{}", index + 1)))
            }
        })
        .collect::<Vec<_>>();
    let definitions = declarations
        .iter()
        .enumerate()
        .map(|(index, value)| (("Chain".to_owned(), format!("item{index}")), value))
        .collect::<Definitions<'_>>();
    // Each resolved call consumes one step; the terminal literal is not a call.
    let at_limit = alias("Chain", "item1");
    assert_eq!(
        evaluated(&definitions, "Chain", &at_limit).unwrap().1,
        &declarations[LIMIT]["body"]
    );
    let over_limit = alias("Chain", "item0");
    assert_eq!(
        evaluated(&definitions, "Chain", &over_limit)
            .unwrap_err()
            .code,
        "PP2001"
    );
}

fn acceptance(request: &str, response: &str) -> Value {
    json!({"kind":"record","fields":[
        {"field":"request","value":{"kind":"bytes","hex":request}},
        {"field":"response","value":{"kind":"bytes","hex":response}}
    ]})
}

#[test]
fn acceptance_tail_aliases_preserve_owner_and_repeated_heads() {
    let wrong = closed(acceptance("00", "00"));
    let right = closed(acceptance("01", "02"));
    let unqualified_head = json!({"kind":"call","function":{"name":"vector"},"arguments":[]});
    let last = closed(json!({"kind":"cons","head":unqualified_head,"tail":{"kind":"nil"}}));
    let middle = closed(json!({"kind":"cons","head":unqualified_head,"tail":
        {"kind":"call","function":{"name":"last"},"arguments":[]}
    }));
    let definitions = BTreeMap::from([
        (("Here".to_owned(), "vector".to_owned()), &wrong),
        (("Other".to_owned(), "vector".to_owned()), &right),
        (("Other".to_owned(), "middle".to_owned()), &middle),
        (("Other".to_owned(), "last".to_owned()), &last),
    ]);
    let list = json!({"kind":"cons","head":acceptance("03","04"),"tail":alias("Other","middle")});
    let fields = BTreeMap::from([("acceptanceVectors", ("Here", &list))]);
    let vectors = acceptance_vectors(&definitions, &fields).unwrap();
    assert_eq!(vectors.len(), 3);
    assert_eq!(vectors[0].request, [3]);
    assert_eq!(vectors[0].response, [4]);
    for vector in &vectors[1..] {
        assert_eq!(vector.request, [1]);
        assert_eq!(vector.response, [2]);
    }
    // An already evaluated outer field carries its own owner too.
    let fields = BTreeMap::from([("acceptanceVectors", ("Other", &last["body"]))]);
    assert_eq!(
        acceptance_vectors(&definitions, &fields).unwrap()[0].request,
        [1]
    );
}

#[test]
fn acceptance_tail_alias_cycles_and_open_values_are_typed_failures() {
    let self_cycle =
        closed(json!({"kind":"cons","head":acceptance("01","02"),"tail":alias("First","self")}));
    let first =
        closed(json!({"kind":"cons","head":acceptance("01","02"),"tail":alias("Second","next")}));
    let second =
        closed(json!({"kind":"cons","head":acceptance("01","02"),"tail":alias("First","next")}));
    let open =
        json!({"kind":"definition","parameters":[{"name":"argument"}],"body":{"kind":"nil"}});
    let definitions = BTreeMap::from([
        (("First".to_owned(), "self".to_owned()), &self_cycle),
        (("First".to_owned(), "next".to_owned()), &first),
        (("Second".to_owned(), "next".to_owned()), &second),
        (("First".to_owned(), "open".to_owned()), &open),
    ]);
    for tail in [alias("First", "self"), alias("First", "next")] {
        let fields = BTreeMap::from([("acceptanceVectors", ("First", &tail))]);
        let error = acceptance_vectors(&definitions, &fields).unwrap_err();
        assert_eq!(error.code, "PP2001");
        assert!(error.message.contains("cyclic alias"));
    }
    for tail in [
        alias("First", "self"),
        alias("First", "next"),
        alias("First", "open"),
        alias("Missing", "next"),
        json!({"kind":"call","function":{"module":null,"name":"self"},"arguments":[]}),
        json!({"kind":"call","function":{"module":"First","name":"self"},"arguments":[{"kind":"nil"}]}),
        json!({"kind":"string","value":"improper list"}),
    ] {
        let list = json!({"kind":"cons","head":acceptance("03","04"),"tail":tail});
        let fields = BTreeMap::from([("acceptanceVectors", ("First", &list))]);
        assert_eq!(
            acceptance_vectors(&definitions, &fields).unwrap_err().code,
            "PP2001"
        );
    }
}

#[test]
fn acceptance_tail_alias_budget_is_shared_across_list_chunks() {
    let declarations = (0..=MAX_METADATA_ALIASES)
        .map(|index| {
            closed(json!({"kind":"cons","head":acceptance("01","02"),"tail":
                if index == MAX_METADATA_ALIASES { json!({"kind":"nil"}) }
                else { alias("Chunks", &format!("item{}", index + 1)) }
            }))
        })
        .collect::<Vec<_>>();
    let definitions = declarations
        .iter()
        .enumerate()
        .map(|(index, value)| (("Chunks".to_owned(), format!("item{index}")), value))
        .collect::<Definitions<'_>>();
    let at_limit = alias("Chunks", "item1");
    let fields = BTreeMap::from([("acceptanceVectors", ("Chunks", &at_limit))]);
    assert_eq!(
        acceptance_vectors(&definitions, &fields).unwrap().len(),
        MAX_METADATA_ALIASES
    );
    let over_limit = alias("Chunks", "item0");
    let fields = BTreeMap::from([("acceptanceVectors", ("Chunks", &over_limit))]);
    let error = acceptance_vectors(&definitions, &fields).unwrap_err();
    assert_eq!(error.code, "PP2001");
    assert!(error.message.contains("alias budget"));
}

#[test]
fn workbench_bytes_append_is_closed_bounded_and_cycle_safe() {
    let append = |left: Value, right: Value| json!({"kind":"primitive","operation":"append","result":{"kind":"bytes"},"arguments":[left,right]});
    let literal = |bytes: &[u8]| json!({"kind":"bytes","hex":bytes.iter().map(|byte|format!("{byte:02x}")).collect::<String>()});
    let chunk = json!({"kind":"definition","parameters":[],"result":{"kind":"bytes"},"body":literal(b"right")});
    let cycle = json!({"kind":"definition","parameters":[],"result":{"kind":"bytes"},"body":append(literal(b"prefix"),alias("Other","cycle"))});
    let definitions = BTreeMap::from([
        (("Other".to_owned(), "chunk".to_owned()), &chunk),
        (("Other".to_owned(), "cycle".to_owned()), &cycle),
    ]);
    let repeated = append(
        literal(b"left"),
        append(alias("Other", "chunk"), alias("Other", "chunk")),
    );
    assert_eq!(
        metadata_bytes(&definitions, "Here", &repeated, "response").unwrap(),
        b"leftrightright"
    );
    let mut large = literal(&vec![b'x'; 1024]);
    for _ in 0..7 {
        large = append(large.clone(), large);
    }
    assert_eq!(
        metadata_bytes(&definitions, "Here", &large, "response").unwrap(),
        vec![b'x'; 131072]
    );
    for bad in [
        alias("Other", "cycle"),
        json!({"kind":"primitive","operation":"length","result":{"kind":"bytes"},"arguments":[literal(b"x")]}),
        json!({"kind":"primitive","operation":"append","result":{"kind":"string"},"arguments":[literal(b"x"),literal(b"y")]}),
        json!({"kind":"call","function":{"module":"Foundation.Bytes","name":"appendBytes"},"arguments":[literal(b"x"),literal(b"y")]}),
        json!({"kind":"bytes","hex":"FF"}),
    ] {
        assert_eq!(
            metadata_bytes(&definitions, "Here", &bad, "response")
                .unwrap_err()
                .code,
            "PP2001"
        );
    }
    let mut deep = literal(b"x");
    for _ in 0..129 {
        deep = append(literal(b""), deep);
    }
    assert!(metadata_bytes(&definitions, "Here", &deep, "response")
        .unwrap_err()
        .to_string()
        .contains("depth"));
    let wide = literal(&vec![0; 16_777_216]);
    let overflow = append(wide, literal(b"x"));
    assert!(metadata_bytes(&definitions, "Here", &overflow, "response")
        .unwrap_err()
        .to_string()
        .contains("16 MiB"));
}

//! Closed source-value projection. No function evaluation or caller snapshots.

use super::{invalid, sdk_source};
use crate::error::PrismError;
use lexlean::SemanticSnapshot;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const MAX_STEPS: usize = 4_194_304;
const MAX_BYTES: usize = 67_108_864;
const MAX_DEPTH: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Member {
    pub(super) module: String,
    pub(super) name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Literal {
    Nat(u32),
    Text(String),
    Bytes(Vec<u8>),
    Record(Member, Vec<(String, Literal)>),
    Variant(Member, usize, Vec<Literal>),
    List(Vec<Literal>),
}

impl Literal {
    pub(super) fn field(&self, name: &str) -> Result<&Self, PrismError> {
        match self {
            Self::Record(_, fields) => fields
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value)
                .ok_or_else(|| invalid("projected record field is absent")),
            _ => Err(invalid("projected metadata is not a record")),
        }
    }

    pub(super) fn text(&self) -> Result<&str, PrismError> {
        match self {
            Self::Text(value) => Ok(value),
            _ => Err(invalid("projected metadata is not text")),
        }
    }

    pub(super) fn member(&self) -> Result<Member, PrismError> {
        Ok(Member {
            module: self.field("module")?.text()?.to_owned(),
            name: self.field("name")?.text()?.to_owned(),
        })
    }
}

pub(super) struct Projection {
    pub(super) member: Member,
    pub(super) module_source: String,
    pub(super) value: Literal,
    pub(super) definitions: BTreeMap<Member, Value>,
}

impl Projection {
    pub(super) fn closed_member(&self, member: &Member) -> Result<Literal, PrismError> {
        let (member, declaration) = self
            .definitions
            .get_key_value(member)
            .ok_or_else(|| invalid("publication requirement member is absent"))?;
        if declaration["kind"] != "definition"
            || !declaration["parameters"]
                .as_array()
                .is_some_and(Vec::is_empty)
        {
            return Err(invalid(
                "publication requirement member is not a closed definition",
            ));
        }
        let mut projector = Projector {
            definitions: &self.definitions,
            steps: MAX_STEPS,
            bytes: MAX_BYTES,
        };
        projector.project(
            &member.module,
            &declaration["body"],
            &member.module,
            &declaration["result"],
            0,
        )
    }
}

fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, PrismError> {
    value[key]
        .as_str()
        .ok_or_else(|| invalid(format!("source metadata {key} is absent")))
}

fn named(owner: &str, value: &Value) -> Result<Member, PrismError> {
    let module = match value.get("module") {
        None => owner,
        Some(module) => module
            .as_str()
            .ok_or_else(|| invalid("source member module is malformed"))?,
    };
    let name = string(value, "name")?;
    if module.is_empty() || name.is_empty() || module.len() > 2048 || name.len() > 2048 {
        return Err(invalid(
            "source member identity exceeds its UTF-8 byte bound",
        ));
    }
    Ok(Member {
        module: module.to_owned(),
        name: name.to_owned(),
    })
}

fn named_type(owner: &str, value: &Value) -> Result<Member, PrismError> {
    if value["kind"] != "named" || !value["arguments"].as_array().is_some_and(Vec::is_empty) {
        return Err(invalid(
            "source metadata requires an exact nongeneric named type",
        ));
    }
    named(owner, &value["member"])
}

fn same_type(left_owner: &str, left: &Value, right_owner: &str, right: &Value) -> bool {
    if left["kind"] != right["kind"] {
        return false;
    }
    match left["kind"].as_str() {
        Some("named") => named_type(left_owner, left)
            .ok()
            .zip(named_type(right_owner, right).ok())
            .is_some_and(|(left, right)| left == right),
        Some("list") => same_type(left_owner, &left["element"], right_owner, &right["element"]),
        Some("string" | "bytes" | "nat") => left == right,
        _ => false,
    }
}

struct Projector<'a> {
    definitions: &'a BTreeMap<Member, Value>,
    steps: usize,
    bytes: usize,
}

impl<'a> Projector<'a> {
    fn charge(&mut self, bytes: usize) -> Result<(), PrismError> {
        self.steps = self
            .steps
            .checked_sub(1)
            .ok_or_else(|| invalid("publication metadata traversal bound exceeded"))?;
        self.bytes = self
            .bytes
            .checked_sub(bytes)
            .ok_or_else(|| invalid("publication metadata aggregate byte bound exceeded"))?;
        Ok(())
    }

    fn resolve(
        &mut self,
        mut owner: &'a str,
        mut value: &'a Value,
    ) -> Result<(&'a str, &'a Value), PrismError> {
        let mut seen = BTreeSet::new();
        loop {
            self.charge(0)?;
            if value["kind"] != "call" {
                return Ok((owner, value));
            }
            if !value["arguments"].as_array().is_some_and(Vec::is_empty) {
                return Err(invalid("publication metadata calls must be closed aliases"));
            }
            let member = named(owner, &value["function"])?;
            if !seen.insert(member.clone()) {
                return Err(invalid("publication metadata alias cycle"));
            }
            let (member, declaration) = self
                .definitions
                .get_key_value(&member)
                .ok_or_else(|| invalid("publication metadata alias is unknown"))?;
            if declaration["kind"] != "definition"
                || !declaration["parameters"]
                    .as_array()
                    .is_some_and(Vec::is_empty)
            {
                return Err(invalid(
                    "publication metadata alias is not a closed definition",
                ));
            }
            owner = &member.module;
            value = declaration
                .get("body")
                .ok_or_else(|| invalid("publication alias body absent"))?;
        }
    }

    fn project(
        &mut self,
        owner: &'a str,
        value: &'a Value,
        type_owner: &'a str,
        ty: &'a Value,
        depth: usize,
    ) -> Result<Literal, PrismError> {
        if depth > MAX_DEPTH {
            return Err(invalid("publication metadata nesting bound exceeded"));
        }
        let (owner, value) = self.resolve(owner, value)?;
        match string(ty, "kind")? {
            "string" => {
                if value["kind"] != "string" {
                    return Err(invalid("publication text literal has a substituted type"));
                }
                let text = string(value, "value")?;
                if text.is_empty() || text.len() > 2048 {
                    return Err(invalid("publication text exceeds its UTF-8 byte bound"));
                }
                self.charge(text.len())?;
                Ok(Literal::Text(text.to_owned()))
            }
            "bytes" => {
                if value["kind"] != "bytes" {
                    return Err(invalid("publication bytes literal has a substituted type"));
                }
                let hex = string(value, "hex")?;
                if hex.len() != 64
                    || !hex
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                {
                    return Err(invalid(
                        "publication metadata requires a canonical SHA-256 byte literal",
                    ));
                }
                self.charge(32)?;
                let bytes = (0..32)
                    .map(|index| {
                        u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16)
                            .map_err(|_| invalid("publication byte literal is malformed"))
                    })
                    .collect::<Result<_, _>>()?;
                Ok(Literal::Bytes(bytes))
            }
            "nat" => {
                if value["kind"] != "nat" {
                    return Err(invalid(
                        "publication natural literal has a substituted type",
                    ));
                }
                let text = string(value, "value")?;
                let parsed = text
                    .parse::<u32>()
                    .map_err(|_| invalid("publication natural literal exceeds UInt32"))?;
                if parsed.to_string() != text {
                    return Err(invalid("publication natural literal is noncanonical"));
                }
                self.charge(4)?;
                Ok(Literal::Nat(parsed))
            }
            "list" => {
                let mut result = Vec::new();
                let mut current = value;
                let mut owner = owner;
                loop {
                    (owner, current) = self.resolve(owner, current)?;
                    if current["kind"] == "nil" {
                        if !same_type(owner, &current["element"], type_owner, &ty["element"]) {
                            return Err(invalid("publication list element type differs"));
                        }
                        return Ok(Literal::List(result));
                    }
                    if current["kind"] != "cons" || result.len() == 256 {
                        return Err(invalid(
                            "publication source inventory must use bounded chunks",
                        ));
                    }
                    result.push(self.project(
                        owner,
                        &current["head"],
                        type_owner,
                        &ty["element"],
                        depth + 1,
                    )?);
                    current = current
                        .get("tail")
                        .ok_or_else(|| invalid("publication list tail is absent"))?;
                }
            }
            "named" => {
                let member = named_type(type_owner, ty)?;
                let (member, declaration) = self
                    .definitions
                    .get_key_value(&member)
                    .ok_or_else(|| invalid("publication metadata type is unknown"))?;
                match string(declaration, "kind")? {
                    "structure" => {
                        if value["kind"] != "record" || named(owner, &value["type"])? != *member {
                            return Err(invalid("publication record type was substituted"));
                        }
                        let input = value["fields"]
                            .as_array()
                            .ok_or_else(|| invalid("publication record fields absent"))?;
                        let fields = declaration["fields"]
                            .as_array()
                            .ok_or_else(|| invalid("publication type fields absent"))?;
                        let mut seen = BTreeSet::new();
                        if input.len() != fields.len()
                            || input.iter().any(|row| {
                                row["field"].as_str().is_none_or(|name| !seen.insert(name))
                            })
                        {
                            return Err(invalid(
                                "publication record has missing, duplicate or extra fields",
                            ));
                        }
                        let mut result = Vec::new();
                        for field in fields {
                            let name = string(field, "name")?;
                            let actual = input
                                .iter()
                                .find(|row| row["field"] == name)
                                .ok_or_else(|| invalid("publication record field absent"))?;
                            result.push((
                                name.to_owned(),
                                self.project(
                                    owner,
                                    &actual["value"],
                                    &member.module,
                                    &field["type"],
                                    depth + 1,
                                )?,
                            ));
                        }
                        Ok(Literal::Record(member.clone(), result))
                    }
                    "inductive" => {
                        if value["kind"] != "constructor" {
                            return Err(invalid("publication enum value is not a constructor"));
                        }
                        let constructor = named(owner, &value["constructor"])?;
                        let cases = declaration["constructors"]
                            .as_array()
                            .ok_or_else(|| invalid("publication enum cases absent"))?;
                        let (index, case) = cases
                            .iter()
                            .enumerate()
                            .find(|(_, case)| {
                                case["name"].as_str().is_some_and(|name| {
                                    constructor.name == format!("{}.{}", member.name, name)
                                }) && constructor.module == member.module
                            })
                            .ok_or_else(|| {
                                invalid("publication enum constructor type was substituted")
                            })?;
                        let types = case["fields"]
                            .as_array()
                            .ok_or_else(|| invalid("publication constructor fields absent"))?;
                        let arguments = value["arguments"]
                            .as_array()
                            .ok_or_else(|| invalid("publication constructor arguments absent"))?;
                        if types.len() != arguments.len() {
                            return Err(invalid("publication constructor arity differs"));
                        }
                        let projected = arguments
                            .iter()
                            .zip(types)
                            .map(|(argument, ty)| {
                                self.project(owner, argument, &member.module, ty, depth + 1)
                            })
                            .collect::<Result<_, _>>()?;
                        Ok(Literal::Variant(member.clone(), index, projected))
                    }
                    _ => Err(invalid(
                        "publication metadata type is not a closed record or enum",
                    )),
                }
            }
            _ => Err(invalid(
                "publication metadata uses an unsupported source type",
            )),
        }
    }
}

pub(super) fn project(snapshot: &SemanticSnapshot) -> Result<Projection, PrismError> {
    let mut definitions = BTreeMap::new();
    for module in snapshot.modules() {
        for declaration in module.declarations() {
            let member = Member {
                module: module.name().to_owned(),
                name: declaration.logical_id().to_owned(),
            };
            if definitions
                .insert(member, declaration.linked_ir().clone())
                .is_some()
            {
                return Err(invalid("publication source declarations are duplicated"));
            }
        }
    }
    let wanted = Member {
        module: sdk_source::LINKAGE.to_owned(),
        name: "PublicationClosure".to_owned(),
    };
    let candidates = definitions
        .iter()
        .filter(|(member, value)| {
            value["kind"] == "definition"
                && named_type(&member.module, &value["result"]).is_ok_and(|ty| ty == wanted)
        })
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return Err(invalid(
            "publication context missing source closure fields: system, target, declaration, services, controls, requirements",
        ));
    }
    if candidates.len() != 1 {
        return Err(invalid(
            "publication requires exactly one source-owned closure definition",
        ));
    }
    let (member, declaration) = candidates[0];
    if !declaration["parameters"]
        .as_array()
        .is_some_and(Vec::is_empty)
    {
        return Err(invalid("publication closure must be a closed source value"));
    }
    let mut projector = Projector {
        definitions: &definitions,
        steps: MAX_STEPS,
        bytes: MAX_BYTES,
    };
    let value = projector.project(
        &member.module,
        &declaration["body"],
        &member.module,
        &declaration["result"],
        0,
    )?;
    let module_source = snapshot
        .modules()
        .iter()
        .find(|module| module.name() == member.module)
        .ok_or_else(|| invalid("publication source module is absent"))?
        .source()
        .sha256()
        .to_string();
    Ok(Projection {
        member: member.clone(),
        module_source,
        value,
        definitions,
    })
}

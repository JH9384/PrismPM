//! Exact JSON and stable file capture. Resource refusal is not schema invalidity.
use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{value::RawValue, Map, Number, Value};
use std::{error::Error, fmt, fs, io::Read, path::Path};

pub const MAX_INPUT: usize = 67_108_864;
const MAX_NODES: usize = 1_000_000;
const MAX_DEPTH: usize = 128;
// The imported engine bounds decimal exponent adjustment at one million.
const MAX_NUMERIC_DIGITS: usize = 1_000_000;
const MAX_EXPONENT: u64 = 1_000_000;

#[derive(Debug)]
pub struct ResourceRefusal(pub &'static str);
impl fmt::Display for ResourceRefusal {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(out, "resource-refusal: {}", self.0)
    }
}
impl Error for ResourceRefusal {}

fn json_error(error: serde_json::Error) -> Box<dyn Error> {
    if error.to_string().starts_with("recursion limit exceeded") {
        Box::new(ResourceRefusal("JSON nesting budget exceeded"))
    } else if error.to_string().starts_with("JSON item budget exceeded") {
        Box::new(ResourceRefusal("JSON item budget exceeded"))
    } else {
        Box::new(error)
    }
}

struct Object<'a>(Vec<(String, &'a RawValue)>);
impl<'de> Deserialize<'de> for Object<'de> {
    fn deserialize<D: Deserializer<'de>>(input: D) -> Result<Self, D::Error> {
        struct ObjectVisitor;
        impl<'de> Visitor<'de> for ObjectVisitor {
            type Value = Object<'de>;
            fn expecting(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
                out.write_str("a JSON object without duplicate keys")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut input: A) -> Result<Object<'de>, A::Error> {
                let mut keys = std::collections::BTreeSet::new();
                let mut entries = Vec::new();
                while let Some(key) = input.next_key::<String>()? {
                    if entries.len() == MAX_NODES {
                        return Err(de::Error::custom("JSON item budget exceeded"));
                    }
                    if !keys.insert(key.clone()) {
                        return Err(de::Error::custom("duplicate JSON key refused"));
                    }
                    entries.push((key, input.next_value()?));
                }
                Ok(Object(entries))
            }
        }
        input.deserialize_map(ObjectVisitor)
    }
}

struct Array<'a>(Vec<&'a RawValue>);
impl<'de> Deserialize<'de> for Array<'de> {
    fn deserialize<D: Deserializer<'de>>(input: D) -> Result<Self, D::Error> {
        struct ArrayVisitor;
        impl<'de> Visitor<'de> for ArrayVisitor {
            type Value = Array<'de>;
            fn expecting(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
                out.write_str("a bounded JSON array")
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut input: A) -> Result<Array<'de>, A::Error> {
                let mut entries = Vec::new();
                while let Some(value) = input.next_element()? {
                    if entries.len() == MAX_NODES {
                        return Err(de::Error::custom("JSON item budget exceeded"));
                    }
                    entries.push(value);
                }
                Ok(Array(entries))
            }
        }
        input.deserialize_seq(ArrayVisitor)
    }
}

fn node(raw: &str, depth: usize, remaining: &mut usize) -> Result<Value, Box<dyn Error>> {
    if depth > MAX_DEPTH || *remaining == 0 {
        return Err(Box::new(ResourceRefusal(
            "JSON nesting or item budget exceeded",
        )));
    }
    *remaining -= 1;
    let raw = raw.trim();
    match raw.as_bytes()[0] {
        b'{' => {
            let Object(entries) = serde_json::from_str(raw).map_err(json_error)?;
            let mut object = Map::new();
            for (key, value) in entries {
                object.insert(key, node(value.get(), depth + 1, remaining)?);
            }
            Ok(Value::Object(object))
        }
        b'[' => {
            let Array(entries) = serde_json::from_str(raw).map_err(json_error)?;
            let mut array = Vec::new();
            for value in entries {
                array.push(node(value.get(), depth + 1, remaining)?);
            }
            Ok(Value::Array(array))
        }
        b'"' => Ok(Value::String(
            serde_json::from_str(raw).map_err(json_error)?,
        )),
        b't' => Ok(Value::Bool(true)),
        b'f' => Ok(Value::Bool(false)),
        b'n' => Ok(Value::Null),
        _ => {
            if raw.bytes().filter(u8::is_ascii_digit).count() > MAX_NUMERIC_DIGITS {
                return Err(Box::new(ResourceRefusal("numeric digit budget exceeded")));
            }
            if let Some((mantissa, exponent)) = raw.split_once(['e', 'E']) {
                let negative = exponent.starts_with('-');
                let digits = exponent
                    .trim_start_matches(['+', '-'])
                    .trim_start_matches('0');
                let exponent = if digits.is_empty() {
                    Ok(0)
                } else {
                    digits.parse::<u64>()
                };
                if !matches!(exponent, Ok(value) if value <= MAX_EXPONENT) {
                    return Err(Box::new(ResourceRefusal(
                        "numeric exponent budget exceeded",
                    )));
                }
                let fraction = mantissa.split_once('.').map_or(0, |(_, tail)| tail.len()) as i64;
                let exponent = exponent.unwrap() as i64 * if negative { -1 } else { 1 };
                if (exponent - fraction).unsigned_abs() > MAX_EXPONENT {
                    return Err(Box::new(ResourceRefusal(
                        "numeric adjustment budget exceeded",
                    )));
                }
            }
            // Deserialize a number only after the imported parser identified its token.
            // Never pass object maps through serde_json's private numeric-map protocol.
            let number: Number = serde_json::from_str(raw).map_err(json_error)?;
            Ok(Value::Number(number))
        }
    }
}

pub fn parse(bytes: &[u8]) -> Result<Value, Box<dyn Error>> {
    if bytes.len() > MAX_INPUT {
        return Err(Box::new(ResourceRefusal("JSON byte budget exceeded")));
    }
    let raw: &RawValue = serde_json::from_slice(bytes).map_err(json_error)?;
    let mut remaining = MAX_NODES;
    node(raw.get(), 0, &mut remaining)
}

#[cfg(unix)]
fn same(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev()
        && left.ino() == right.ino()
        && left.len() == right.len()
        && left.mode() == right.mode()
        && left.nlink() == right.nlink()
        && left.uid() == right.uid()
        && left.gid() == right.gid()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
        && left.ctime() == right.ctime()
        && left.ctime_nsec() == right.ctime_nsec()
}

#[cfg(unix)]
fn capture(path: &Path, mut boundary: impl FnMut(u8)) -> Result<Vec<u8>, Box<dyn Error>> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    let path = std::path::absolute(path)?;
    if path.canonicalize()? != path {
        return Err("aliased subject path refused".into());
    }
    let initial = fs::symlink_metadata(&path)?;
    if !initial.is_file() || initial.nlink() != 1 {
        return Err("regular singly linked subject required".into());
    }
    if initial.len() > MAX_INPUT as u64 {
        return Err(Box::new(ResourceRefusal("subject byte budget exceeded")));
    }
    boundary(0);
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(&path)?;
    if !same(&initial, &file.metadata()?) {
        return Err("subject changed before capture".into());
    }
    boundary(1);
    let mut bytes = Vec::new();
    (&file)
        .take((MAX_INPUT + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_INPUT {
        return Err(Box::new(ResourceRefusal("subject byte budget exceeded")));
    }
    boundary(2);
    if bytes.len() as u64 != initial.len()
        || !same(&initial, &file.metadata()?)
        || !same(&initial, &fs::symlink_metadata(&path)?)
        || path.canonicalize()? != path
    {
        return Err("subject changed during capture".into());
    }
    Ok(bytes)
}

pub fn subject(path: &Path) -> Result<Vec<u8>, Box<dyn Error>> {
    #[cfg(unix)]
    {
        capture(path, |_| {})
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Err(Box::new(ResourceRefusal(
            "stable capture requires a supported Unix SDK",
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_container_children_borrow_the_original_subject() {
        let bytes = br#"{"outer":[{"inner":"unchanged payload"},18446744073709551617]}"#;
        let low = bytes.as_ptr() as usize;
        let high = low + bytes.len();
        let raw: &RawValue = serde_json::from_slice(bytes).unwrap();
        let Object(rows) = serde_json::from_str(raw.get()).unwrap();
        let Array(items) = serde_json::from_str(rows[0].1.get()).unwrap();
        let Object(inner) = serde_json::from_str(items[0].get()).unwrap();
        for child in [raw, rows[0].1, items[0], items[1], inner[0].1] {
            let pointer = child.get().as_ptr() as usize;
            assert!(
                pointer >= low && pointer + child.get().len() <= high,
                "raw descendants must borrow captured input, not clone nested payloads"
            );
        }
    }

    #[test]
    fn actual_maximum_bytes_and_nesting_preserve_the_complete_payload() {
        let payload_size = MAX_INPUT - 2 * MAX_DEPTH - 2;
        let mut bytes = Vec::with_capacity(MAX_INPUT);
        bytes.extend(std::iter::repeat_n(b'[', MAX_DEPTH));
        bytes.push(b'"');
        bytes.extend(std::iter::repeat_n(b'a', payload_size));
        bytes.push(b'"');
        bytes.extend(std::iter::repeat_n(b']', MAX_DEPTH));
        assert_eq!(bytes.len(), MAX_INPUT);
        let document = parse(&bytes).expect("the full byte and nesting domain must parse");
        let mut leaf = &document;
        for _ in 0..MAX_DEPTH {
            let array = leaf.as_array().unwrap();
            assert_eq!(array.len(), 1);
            leaf = &array[0];
        }
        let payload = leaf.as_str().unwrap();
        assert_eq!(payload.len(), payload_size);
        assert!(payload.bytes().all(|byte| byte == b'a'));
    }

    #[test]
    fn actual_item_and_numeric_boundaries_return_resource_outcomes() {
        let mut bytes = Vec::with_capacity(2 * MAX_NODES);
        bytes.push(b'[');
        for _ in 0..MAX_NODES - 2 {
            bytes.extend_from_slice(b"0,");
        }
        bytes.extend_from_slice(b"0]");
        assert_eq!(
            parse(&bytes).unwrap().as_array().unwrap().len(),
            MAX_NODES - 1
        );
        bytes.pop();
        bytes.extend_from_slice(b",0]");
        assert!(parse(&bytes)
            .unwrap_err()
            .downcast_ref::<ResourceRefusal>()
            .is_some());
        let mut digits = vec![b'7'; MAX_NUMERIC_DIGITS];
        assert_eq!(
            parse(&digits).unwrap().as_number().unwrap().as_str().len(),
            MAX_NUMERIC_DIGITS
        );
        digits.push(b'7');
        assert!(parse(&digits)
            .unwrap_err()
            .downcast_ref::<ResourceRefusal>()
            .is_some());
        assert!(parse(b"1e1000000").is_ok());
        assert!(parse(b"1e-1000000").is_ok());
        assert!(parse(b"1.1e-1000000")
            .unwrap_err()
            .downcast_ref::<ResourceRefusal>()
            .is_some());
    }

    #[test]
    fn exact_numbers_reserved_keys_and_resource_refusals() {
        for text in [
            "18446744073709551617",
            "1.0000000000000000000000000000000001",
        ] {
            assert_eq!(
                parse(text.as_bytes())
                    .unwrap()
                    .as_number()
                    .unwrap()
                    .as_str(),
                text
            );
        }
        assert_eq!(
            parse(b"1e400").unwrap().as_number().unwrap().as_str(),
            "1e+400"
        );
        assert_eq!(
            parse(br#"{"$serde_json::private::Number":"1"}"#)
                .unwrap()
                .as_object()
                .unwrap()
                .len(),
            1
        );
        for bytes in [
            br#"{"x":1,"\u0078":2}"#.as_slice(),
            br#"{"nested":[{"x":1,"x":2}]}"#,
            br#"{"$serde_json::private::Number":"1","$serde_json::private::Number":"2"}"#,
        ] {
            assert!(parse(bytes).is_err());
        }
        let error = parse(b"1e1000001").unwrap_err();
        assert!(error.downcast_ref::<ResourceRefusal>().is_some());
        let deep = format!(
            "{}0{}",
            "[".repeat(MAX_DEPTH + 1),
            "]".repeat(MAX_DEPTH + 1)
        );
        assert!(parse(deep.as_bytes())
            .unwrap_err()
            .downcast_ref::<ResourceRefusal>()
            .is_some());
        assert!(parse(&vec![b' '; MAX_INPUT + 1])
            .unwrap_err()
            .downcast_ref::<ResourceRefusal>()
            .is_some());
        let mut nodes = 0;
        assert!(node("true", 0, &mut nodes)
            .unwrap_err()
            .downcast_ref::<ResourceRefusal>()
            .is_some());
    }

    #[cfg(unix)]
    struct Directory(std::path::PathBuf);
    #[cfg(unix)]
    impl Directory {
        fn new() -> Self {
            use std::os::unix::fs::DirBuilderExt;
            static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let serial = SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "prismpm-oscal-capture-{}-{serial}",
                std::process::id()
            ));
            fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
            Self(path)
        }
    }
    #[cfg(unix)]
    impl Drop for Directory {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[cfg(unix)]
    #[test]
    fn stable_capture_rejects_real_path_inode_link_and_content_substitution() {
        use std::os::unix::fs::symlink;
        let root = Directory::new();
        let path = root.0.join("subject.json");
        fs::write(&path, b"{\"stable\":true}").unwrap();
        assert_eq!(subject(&path).unwrap(), b"{\"stable\":true}");
        let alias = root.0.join("alias.json");
        symlink(&path, &alias).unwrap();
        assert!(subject(&alias).is_err());
        let parent_alias = root.0.join("parent");
        symlink(&root.0, &parent_alias).unwrap();
        assert!(subject(&parent_alias.join("subject.json")).is_err());
        let linked = root.0.join("linked.json");
        fs::hard_link(&path, &linked).unwrap();
        assert!(subject(&path).is_err());
        fs::remove_file(linked).unwrap();
        assert!(subject(&root.0).is_err());

        for stage in 0..=2 {
            fs::write(&path, b"{\"stable\":true}").unwrap();
            let replacement = root.0.join("replacement.json");
            fs::write(&replacement, b"{\"stable\":true}").unwrap();
            let result = capture(&path, |current| {
                if current == stage {
                    fs::rename(&replacement, &path).unwrap();
                }
            });
            assert!(
                result.is_err(),
                "same-byte inode substitution at stage {stage}"
            );
        }
        for stage in 1..=2 {
            fs::write(&path, b"true").unwrap();
            let result = capture(&path, |current| {
                if current == stage {
                    fs::write(&path, b"null").unwrap();
                }
            });
            assert!(
                result.is_err(),
                "same-size content substitution at stage {stage}"
            );
        }
        fs::write(&path, b"true").unwrap();
        let result = capture(&path, |stage| {
            if stage == 0 {
                fs::remove_file(&path).unwrap();
                symlink(&alias, &path).unwrap();
            }
        });
        assert!(result.is_err(), "symlink inserted after initial metadata");

        fs::remove_file(&path).unwrap();
        fs::write(&path, b"true").unwrap();
        let result = capture(&path, |stage| {
            if stage == 0 {
                fs::remove_file(&path).unwrap();
                assert!(std::process::Command::new("/usr/bin/mkfifo")
                    .arg(&path)
                    .status()
                    .unwrap()
                    .success());
            }
        });
        assert!(result.is_err(), "FIFO substituted after initial metadata");
    }

    #[cfg(unix)]
    #[test]
    fn capture_is_bounded_before_and_after_open() {
        let root = Directory::new();
        let path = root.0.join("subject.json");
        for stage in [None, Some(1)] {
            fs::write(&path, b"true").unwrap();
            if stage.is_none() {
                fs::OpenOptions::new()
                    .write(true)
                    .open(&path)
                    .unwrap()
                    .set_len((MAX_INPUT + 1) as u64)
                    .unwrap();
            }
            let error = capture(&path, |current| {
                if stage == Some(current) {
                    fs::OpenOptions::new()
                        .write(true)
                        .open(&path)
                        .unwrap()
                        .set_len((MAX_INPUT + 1) as u64)
                        .unwrap();
                }
            })
            .unwrap_err();
            assert!(error.downcast_ref::<ResourceRefusal>().is_some());
        }
    }
}

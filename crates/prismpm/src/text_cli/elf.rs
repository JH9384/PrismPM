//! Closed structural check that a built program is a static Linux executable.

use crate::error::PrismError;

const PT_DYNAMIC: u32 = 2;
const PT_INTERP: u32 = 3;
const DT_NEEDED: u64 = 1;
const DT_NULL: u64 = 0;

fn invalid(message: &str) -> PrismError {
    PrismError::new("PP4102", message)
}

fn machine(target: &str) -> Result<u16, PrismError> {
    match target {
        "x86_64-unknown-linux-musl" => Ok(0x3e),
        "aarch64-unknown-linux-musl" => Ok(0xb7),
        _ => Err(invalid(
            "command-line target is not a registered musl target",
        )),
    }
}

fn field(bytes: &[u8], offset: usize, width: usize) -> Result<u64, PrismError> {
    let end = offset
        .checked_add(width)
        .ok_or_else(|| invalid("command-line executable is truncated"))?;
    let slice = bytes
        .get(offset..end)
        .ok_or_else(|| invalid("command-line executable is truncated"))?;
    Ok(slice
        .iter()
        .rev()
        .fold(0u64, |value, byte| (value << 8) | u64::from(*byte)))
}

/// Require a little-endian 64-bit ELF executable for the exact machine of the
/// target with no interpreter and no needed shared library.
pub(crate) fn validate_static_elf(bytes: &[u8], target: &str) -> Result<(), PrismError> {
    if bytes.get(..4) != Some(b"\x7fELF".as_slice())
        || bytes.get(4) != Some(&2)
        || bytes.get(5) != Some(&1)
    {
        return Err(invalid(
            "command-line output is not a little-endian ELF64 file",
        ));
    }
    let file_type = field(bytes, 16, 2)?;
    if !matches!(file_type, 2 | 3) || field(bytes, 18, 2)? != u64::from(machine(target)?) {
        return Err(invalid(
            "command-line executable type or machine differs from its target",
        ));
    }
    let table = usize::try_from(field(bytes, 32, 8)?)
        .map_err(|_| invalid("command-line program-header table is out of range"))?;
    let entry_size = usize::try_from(field(bytes, 54, 2)?)
        .map_err(|_| invalid("command-line program-header size is out of range"))?;
    let count = usize::try_from(field(bytes, 56, 2)?)
        .map_err(|_| invalid("command-line program-header count is out of range"))?;
    if entry_size < 56 || count == 0 {
        return Err(invalid("command-line program-header table is malformed"));
    }
    for index in 0..count {
        let header = index
            .checked_mul(entry_size)
            .and_then(|offset| offset.checked_add(table))
            .ok_or_else(|| invalid("command-line program header is out of range"))?;
        let kind = field(bytes, header, 4)?;
        if kind == u64::from(PT_INTERP) {
            return Err(invalid(
                "command-line executable requests a dynamic interpreter",
            ));
        }
        if kind == u64::from(PT_DYNAMIC) {
            let offset = usize::try_from(field(bytes, header + 8, 8)?)
                .map_err(|_| invalid("command-line dynamic section is out of range"))?;
            let size = usize::try_from(field(bytes, header + 32, 8)?)
                .map_err(|_| invalid("command-line dynamic section is out of range"))?;
            for entry in 0..size / 16 {
                let tag = field(bytes, offset + entry * 16, 8)?;
                if tag == DT_NEEDED {
                    return Err(invalid("command-line executable needs a shared library"));
                }
                if tag == DT_NULL {
                    break;
                }
            }
        }
    }
    Ok(())
}

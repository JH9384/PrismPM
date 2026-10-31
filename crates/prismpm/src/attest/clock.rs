//! Civil time as milliseconds since the Unix epoch, both ways, with no
//! dependency. The trusted root and the timestamps speak RFC 3339 in UTC and
//! the result prints the signed time the way `Date.prototype.toISOString`
//! does, so the Rust and JavaScript verifiers report the same text.

/// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_index = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    }
}

/// Milliseconds since the epoch of a UTC civil time, `None` when a field is out of range.
pub(crate) fn utc_millis(
    year: i64,
    month: i64,
    day: i64,
    hour: i64,
    minute: i64,
    second: i64,
    millis: i64,
) -> Option<i64> {
    if !(1..=12).contains(&month)
        || day < 1
        || day > days_in_month(year, month)
        || !(0..24).contains(&hour)
        || !(0..60).contains(&minute)
        || !(0..60).contains(&second)
        || !(0..1000).contains(&millis)
        || !(0..=9999).contains(&year)
    {
        return None;
    }
    let days = days_from_civil(year, month, day);
    Some((((days * 24 + hour) * 60 + minute) * 60 + second) * 1000 + millis)
}

/// Parse an RFC 3339 UTC time such as `2026-05-13T19:23:33Z` or `2022-12-31T23:59:59.999Z`.
pub(crate) fn parse_rfc3339(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    if bytes[13] != b':' || bytes[16] != b':' || *bytes.last()? != b'Z' {
        return None;
    }
    let number = |from: usize, to: usize| -> Option<i64> {
        let slice = &text[from..to];
        if slice.bytes().all(|byte| byte.is_ascii_digit()) {
            slice.parse().ok()
        } else {
            None
        }
    };
    let mut millis = 0;
    if bytes.len() > 20 {
        if bytes[19] != b'.' || bytes.len() < 22 {
            return None;
        }
        let mut fraction = text[20..text.len() - 1].to_owned();
        if fraction.is_empty() || !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        fraction.truncate(3);
        while fraction.len() < 3 {
            fraction.push('0');
        }
        millis = fraction.parse().ok()?;
    } else if bytes.len() != 20 {
        return None;
    }
    utc_millis(
        number(0, 4)?,
        number(5, 7)?,
        number(8, 10)?,
        number(11, 13)?,
        number(14, 16)?,
        number(17, 19)?,
        millis,
    )
}

/// The ISO 8601 text of a time, always with milliseconds, as JavaScript prints it.
pub(crate) fn iso8601(millis: i64) -> String {
    let days = millis.div_euclid(86_400_000);
    let rest = millis.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3_600_000,
        rest / 60_000 % 60,
        rest / 1000 % 60,
        rest % 1000
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_matches_javascript_text() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_rfc3339("2026-05-13T19:23:33Z"),
            Some(1_778_700_213_000)
        );
        assert_eq!(
            parse_rfc3339("2022-12-31T23:59:59.999Z"),
            Some(1_672_531_199_999)
        );
        assert_eq!(
            parse_rfc3339("2022-12-31T23:59:59.9Z"),
            Some(1_672_531_199_900)
        );
        assert_eq!(iso8601(1_778_700_213_000), "2026-05-13T19:23:33.000Z");
        assert_eq!(iso8601(1_672_531_199_999), "2022-12-31T23:59:59.999Z");
        assert_eq!(parse_rfc3339("2022-13-01T00:00:00Z"), None);
        assert_eq!(parse_rfc3339("2022-02-29T00:00:00Z"), None);
        assert_eq!(
            parse_rfc3339("2024-02-29T00:00:00Z")
                .map(iso8601)
                .as_deref(),
            Some("2024-02-29T00:00:00.000Z")
        );
        assert_eq!(parse_rfc3339("not a time"), None);
    }
}

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde_json::{Map, Value};
use std::collections::HashMap;

use crate::chat_manager::tooling::ToolCall;

const OPERATION_ROOT_TAGS: &[&str] = &["memory_ops", "operations"];
const REPAIR_ROOT_TAGS: &[&str] = &["memory_repairs", "items"];
const OPERATION_TAGS: &[&str] = &[
    "create_memory",
    "delete_memory",
    "pin_memory",
    "unpin_memory",
    "done",
];

pub const MEMORY_OPERATIONS_XML_FALLBACK_PROMPT: &str = r#"Return only XML. Format: <memory_ops><create_memory important="false"><text>...</text><category>plot_event</category></create_memory><delete_memory confidence="0.9"><text>123456</text></delete_memory><pin_memory><id>123456</id></pin_memory><unpin_memory><id>123456</id></unpin_memory><done><summary>optional note</summary></done></memory_ops>. Use an empty <memory_ops /> when no changes are needed. Do not use markdown."#;

pub const MEMORY_REPAIRS_XML_FALLBACK_PROMPT: &str = r#"Return only XML. Format: <memory_repairs><item><text>...</text><category>other</category></item></memory_repairs>. Use exactly one <item> per input text. Do not use markdown."#;

fn normalize_structured_fallback_text(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with("```") {
        let mut lines = trimmed.lines();
        let _ = lines.next();
        let mut body: Vec<&str> = lines.collect();
        if body
            .last()
            .map(|line| line.trim() == "```")
            .unwrap_or(false)
        {
            body.pop();
        }
        return body.join("\n").trim().to_string();
    }
    trimmed.to_string()
}

fn extract_xml_snippet<'a>(raw: &'a str, root_tags: &[&str]) -> Option<&'a str> {
    for root in root_tags {
        let start_marker = format!("<{}", root);
        let end_marker = format!("</{}>", root);
        if let Some(start_idx) = raw.find(&start_marker) {
            if let Some(rel_end_idx) = raw[start_idx..].find(&end_marker) {
                let end_idx = start_idx + rel_end_idx + end_marker.len();
                return Some(&raw[start_idx..end_idx]);
            }
            if let Some(rel_end_idx) = raw[start_idx..].find("/>") {
                let end_idx = start_idx + rel_end_idx + 2;
                return Some(&raw[start_idx..end_idx]);
            }
        }
    }
    None
}

fn attr_value(element: &BytesStart<'_>, key: &[u8]) -> Option<String> {
    for attr in element.attributes().flatten() {
        if attr.key.as_ref() == key {
            return Some(String::from_utf8_lossy(attr.value.as_ref()).into_owned());
        }
    }
    None
}

fn insert_if_present(args: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        args.insert(key.to_string(), Value::String(value));
    }
}

fn insert_bool_attr(args: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        let normalized = value.trim().to_ascii_lowercase();
        if matches!(normalized.as_str(), "true" | "1" | "yes") {
            args.insert(key.to_string(), Value::Bool(true));
        } else if matches!(normalized.as_str(), "false" | "0" | "no") {
            args.insert(key.to_string(), Value::Bool(false));
        }
    }
}

fn insert_number_attr(args: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value.and_then(|v| v.trim().parse::<f64>().ok()) {
        if let Some(number) = serde_json::Number::from_f64(value) {
            args.insert(key.to_string(), Value::Number(number));
        }
    }
}

fn parse_memory_operations_from_xml(raw: &str) -> Result<Vec<ToolCall>, String> {
    let normalized = normalize_structured_fallback_text(raw);
    let snippet = extract_xml_snippet(&normalized, OPERATION_ROOT_TAGS)
        .ok_or_else(|| "fallback response did not contain valid XML".to_string())?;

    let mut reader = Reader::from_str(snippet);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut root_seen = false;
    let mut current_op_name: Option<String> = None;
    let mut current_args = Map::new();
    let mut current_field: Option<String> = None;
    let mut calls = Vec::new();
    let mut op_index = 0usize;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => {
                let tag = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                if !root_seen && OPERATION_ROOT_TAGS.contains(&tag.as_str()) {
                    root_seen = true;
                } else if root_seen && current_op_name.is_none() {
                    let op_name = if tag == "operation" {
                        attr_value(&event, b"name")
                            .or_else(|| attr_value(&event, b"op"))
                            .unwrap_or_default()
                    } else {
                        tag.clone()
                    };
                    if OPERATION_TAGS.contains(&op_name.as_str()) {
                        current_op_name = Some(op_name);
                        current_args = Map::new();
                        insert_if_present(&mut current_args, "text", attr_value(&event, b"text"));
                        insert_if_present(
                            &mut current_args,
                            "category",
                            attr_value(&event, b"category"),
                        );
                        insert_if_present(&mut current_args, "id", attr_value(&event, b"id"));
                        insert_if_present(
                            &mut current_args,
                            "summary",
                            attr_value(&event, b"summary"),
                        );
                        insert_bool_attr(
                            &mut current_args,
                            "important",
                            attr_value(&event, b"important"),
                        );
                        insert_number_attr(
                            &mut current_args,
                            "confidence",
                            attr_value(&event, b"confidence"),
                        );
                    }
                } else if current_op_name.is_some() {
                    current_field = Some(tag);
                }
            }
            Ok(Event::Empty(event)) => {
                let tag = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                if !root_seen && OPERATION_ROOT_TAGS.contains(&tag.as_str()) {
                    root_seen = true;
                } else if root_seen && current_op_name.is_none() {
                    let op_name = if tag == "operation" {
                        attr_value(&event, b"name")
                            .or_else(|| attr_value(&event, b"op"))
                            .unwrap_or_default()
                    } else {
                        tag.clone()
                    };
                    if OPERATION_TAGS.contains(&op_name.as_str()) {
                        let mut args = Map::new();
                        insert_if_present(&mut args, "text", attr_value(&event, b"text"));
                        insert_if_present(&mut args, "category", attr_value(&event, b"category"));
                        insert_if_present(&mut args, "id", attr_value(&event, b"id"));
                        insert_if_present(&mut args, "summary", attr_value(&event, b"summary"));
                        insert_bool_attr(&mut args, "important", attr_value(&event, b"important"));
                        insert_number_attr(
                            &mut args,
                            "confidence",
                            attr_value(&event, b"confidence"),
                        );
                        op_index += 1;
                        calls.push(ToolCall {
                            id: format!("xml_op_{}", op_index),
                            name: op_name,
                            arguments: Value::Object(args),
                            raw_arguments: None,
                        });
                    }
                }
            }
            Ok(Event::Text(event)) => {
                if let (Some(field), Some(_)) = (current_field.as_deref(), current_op_name.as_ref()) {
                    let text = String::from_utf8_lossy(event.as_ref()).trim().to_string();
                    if !text.is_empty() {
                        current_args.insert(field.to_string(), Value::String(text));
                    }
                }
            }
            Ok(Event::CData(event)) => {
                if let (Some(field), Some(_)) = (current_field.as_deref(), current_op_name.as_ref()) {
                    let text = String::from_utf8_lossy(event.as_ref()).trim().to_string();
                    if !text.is_empty() {
                        current_args.insert(field.to_string(), Value::String(text));
                    }
                }
            }
            Ok(Event::End(event)) => {
                let tag = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                if current_field.as_deref() == Some(tag.as_str()) {
                    current_field = None;
                } else if current_op_name.as_deref() == Some(tag.as_str())
                    || (tag == "operation" && current_op_name.is_some())
                {
                    op_index += 1;
                    calls.push(ToolCall {
                        id: format!("xml_op_{}", op_index),
                        name: current_op_name.take().unwrap_or_default(),
                        arguments: Value::Object(std::mem::take(&mut current_args)),
                        raw_arguments: None,
                    });
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => {
                return Err(format!("fallback XML parse error: {}", err));
            }
            _ => {}
        }
        buf.clear();
    }

    if !root_seen {
        return Err("fallback response did not contain valid XML".to_string());
    }

    Ok(calls)
}

fn parse_memory_tag_repairs_from_xml(
    raw: &str,
    allowed_categories: &[&str],
) -> Result<HashMap<String, String>, String> {
    let normalized = normalize_structured_fallback_text(raw);
    let snippet = extract_xml_snippet(&normalized, REPAIR_ROOT_TAGS)
        .ok_or_else(|| "fallback response did not contain valid XML".to_string())?;

    let mut reader = Reader::from_str(snippet);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut root_seen = false;
    let mut in_item = false;
    let mut current_text: Option<String> = None;
    let mut current_category: Option<String> = None;
    let mut current_field: Option<String> = None;
    let mut repaired = HashMap::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => {
                let tag = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                if !root_seen && REPAIR_ROOT_TAGS.contains(&tag.as_str()) {
                    root_seen = true;
                } else if root_seen && tag == "item" {
                    in_item = true;
                    current_text = attr_value(&event, b"text");
                    current_category = attr_value(&event, b"category");
                } else if in_item {
                    current_field = Some(tag);
                }
            }
            Ok(Event::Empty(event)) => {
                let tag = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                if !root_seen && REPAIR_ROOT_TAGS.contains(&tag.as_str()) {
                    root_seen = true;
                } else if root_seen && tag == "item" {
                    let text = attr_value(&event, b"text");
                    let category = attr_value(&event, b"category");
                    if let (Some(text), Some(category)) = (text, category) {
                        if allowed_categories.contains(&category.as_str()) {
                            repaired.insert(text, category);
                        }
                    }
                }
            }
            Ok(Event::Text(event)) => {
                if let Some(field) = current_field.as_deref() {
                    let text = String::from_utf8_lossy(event.as_ref()).trim().to_string();
                    if !text.is_empty() {
                        match field {
                            "text" => current_text = Some(text),
                            "category" => current_category = Some(text),
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::CData(event)) => {
                if let Some(field) = current_field.as_deref() {
                    let text = String::from_utf8_lossy(event.as_ref()).trim().to_string();
                    if !text.is_empty() {
                        match field {
                            "text" => current_text = Some(text),
                            "category" => current_category = Some(text),
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::End(event)) => {
                let tag = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                if current_field.as_deref() == Some(tag.as_str()) {
                    current_field = None;
                } else if tag == "item" {
                    in_item = false;
                    if let (Some(text), Some(category)) = (current_text.take(), current_category.take()) {
                        if allowed_categories.contains(&category.as_str()) {
                            repaired.insert(text, category);
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("fallback XML parse error: {}", err)),
            _ => {}
        }
        buf.clear();
    }

    if !root_seen {
        return Err("fallback response did not contain valid XML".to_string());
    }

    Ok(repaired)
}

pub fn parse_memory_operations_from_text(raw: &str) -> Result<Vec<ToolCall>, String> {
    parse_memory_operations_from_xml(raw)
}

pub fn parse_memory_tag_repairs_from_text(
    raw: &str,
    allowed_categories: &[&str],
) -> Result<HashMap<String, String>, String> {
    parse_memory_tag_repairs_from_xml(raw, allowed_categories)
}

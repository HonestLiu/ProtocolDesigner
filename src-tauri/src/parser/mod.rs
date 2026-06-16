use crate::commands::ProtocolIR;

pub fn validate_schema(ir: &ProtocolIR) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut errors = Vec::new();

    for msg in &ir.messages {
        if msg.name.is_empty() {
            errors.push(format!("Message {} has empty name", msg.id));
        }
        for field_id in &msg.fields {
            if !ir.fields.iter().any(|f| &f.id == field_id) {
                errors.push(format!("Message '{}' references unknown field '{}'", msg.name, field_id));
            }
        }
    }

    for st in &ir.structs {
        if st.name.is_empty() {
            errors.push(format!("Struct {} has empty name", st.id));
        }
        for field_id in &st.fields {
            if !ir.fields.iter().any(|f| &f.id == field_id) {
                errors.push(format!("Struct '{}' references unknown field '{}'", st.name, field_id));
            }
        }
    }

    for field in &ir.fields {
        if field.name.is_empty() {
            errors.push(format!("Field {} has empty name", field.id));
        }
    }

    Ok(errors)
}

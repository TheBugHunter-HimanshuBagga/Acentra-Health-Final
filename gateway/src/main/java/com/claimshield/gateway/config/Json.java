package com.claimshield.gateway.config;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** JSON helpers on Jackson 3 (Spring Boot 4). {@link #canonical} is deterministic: object keys are sorted. */
@Component
public class Json {

  private final JsonMapper mapper;

  public Json(JsonMapper mapper) {
    this.mapper = mapper;
  }

  public JsonNode tree(String json) {
    return mapper.readTree(json);
  }

  public String write(Object value) {
    return mapper.writeValueAsString(value);
  }

  /** Canonical JSON for hashing: sorted keys, no whitespace. Accepts Map, List, String, Number, Boolean, null. */
  public String canonical(Object value) {
    StringBuilder sb = new StringBuilder();
    appendCanonical(sb, value);
    return sb.toString();
  }

  @SuppressWarnings("unchecked")
  private void appendCanonical(StringBuilder sb, Object v) {
    switch (v) {
      case null -> sb.append("null");
      case Map<?, ?> m -> {
        TreeMap<String, Object> sorted = new TreeMap<>();
        m.forEach((k, val) -> sorted.put(String.valueOf(k), val));
        sb.append('{');
        boolean first = true;
        for (Map.Entry<String, Object> e : sorted.entrySet()) {
          if (!first) sb.append(',');
          first = false;
          sb.append(mapper.writeValueAsString(e.getKey())).append(':');
          appendCanonical(sb, e.getValue());
        }
        sb.append('}');
      }
      case List<?> l -> {
        sb.append('[');
        for (int i = 0; i < l.size(); i++) {
          if (i > 0) sb.append(',');
          appendCanonical(sb, l.get(i));
        }
        sb.append(']');
      }
      case Boolean b -> sb.append(b);
      case Integer i -> sb.append(i);
      case Long l -> sb.append(l);
      case BigDecimal d -> sb.append(d.toPlainString());
      case Number n -> sb.append(mapper.writeValueAsString(n));
      default -> sb.append(mapper.writeValueAsString(v.toString()));
    }
  }
}

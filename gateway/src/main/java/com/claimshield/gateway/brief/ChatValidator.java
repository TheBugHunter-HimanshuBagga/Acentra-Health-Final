package com.claimshield.gateway.brief;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;

/**
 * The same discipline as the brief validator, for chat answers. A chat answer is a handful of sentences; each cites
 * source IDs that tools returned THIS turn; numbers are placeholders resolved from the tool results; nothing else
 * with a digit, an entity ID, a forbidden word, a link or a contradicting tier word gets through.
 */
public final class ChatValidator {

  public static final int MAX_SENTENCES = 6;

  public record Sentence(String text, List<String> ids) {}

  /** What the tools returned in this turn: the only world an answer may draw on. */
  public record Turn(JsonNode pack, Set<String> sourceIds, Map<String, String> numbers,
      Map<String, List<String>> trustedText, Set<String> entities) {}

  private ChatValidator() {}

  public static List<String> validate(List<Sentence> sentences, Turn turn) {
    List<String> problems = new ArrayList<>();
    if (sentences.isEmpty() || sentences.size() > MAX_SENTENCES) {
      problems.add("an answer needs between 1 and " + MAX_SENTENCES + " sentences");
    }
    PackIndex px = turn.pack() == null ? null : new PackIndex(turn.pack());
    Set<String> allowedIds = new LinkedHashSet<>(turn.sourceIds());
    if (px != null) {
      allowedIds.addAll(px.ids);
    }
    List<String> tokens = new ArrayList<>(allowedIds);
    tokens.addAll(turn.entities());
    if (px != null) {
      tokens.addAll(px.allowedTokens);
    }
    tokens.sort(Comparator.comparingInt(String::length).reversed());
    List<String> forbidden = new ArrayList<>(px != null ? px.forbidden : List.of("fraud", "fraudulent", "criminal",
        "guilty", "illegal", "steal", "scam", "intentional", "deliberate", "knowingly", "kickback"));
    forbidden.addAll(BriefValidator.EXTRA_FORBIDDEN);
    for (int i = 0; i < sentences.size(); i++) {
      Sentence s = sentences.get(i);
      String at = "sentence " + (i + 1);
      if (s.ids().isEmpty()) {
        problems.add(at + " cites nothing");
        continue;
      }
      for (String id : s.ids()) {
        if (!allowedIds.contains(id)) {
          problems.add(at + " cites " + id + ", which no tool returned");
        }
      }
      Matcher m = BriefValidator.PLACEHOLDER.matcher(s.text());
      Map<String, String> numbers = turn.numbers();
      while (m.find()) {
        String key = m.group(1);
        boolean known = numbers.containsKey(key) || (px != null && px.numbers.containsKey(key));
        if (!known) {
          problems.add(at + " uses unknown number {{" + key + "}}");
          continue;
        }
        String owner = key.substring(0, Math.max(0, key.indexOf('.')));
        boolean cited = "S".equals(owner) && px != null
            ? s.ids().stream().anyMatch(px.tierReasonIds::contains) : s.ids().contains(owner);
        if (!cited) {
          problems.add(at + " uses {{" + key + "}} without citing its source");
        }
      }
      String rest = BriefValidator.PLACEHOLDER.matcher(s.text()).replaceAll(" ");
      if (rest.contains("{{") || rest.contains("}}")) {
        problems.add(at + " has a malformed placeholder");
      }
      String stripped = rest;
      List<String> trusted = new ArrayList<>();
      for (String id : s.ids()) {
        trusted.addAll(turn.trustedText().getOrDefault(id, List.of()));
        if (px != null) {
          trusted.addAll(px.textById.getOrDefault(id, List.of()));
        }
      }
      trusted.sort(Comparator.comparingInt(String::length).reversed());
      for (String t : trusted) {
        if (!t.isBlank()) {
          stripped = stripped.replace(t, " ");
        }
      }
      String digits = stripped;
      for (String tok : tokens) {
        digits = digits.replaceAll("(?<![A-Za-z0-9])" + Pattern.quote(tok) + "(?![A-Za-z0-9])", " ");
      }
      Matcher d = Pattern.compile("[$]?\\d[\\d,.]*").matcher(digits);
      if (d.find()) {
        problems.add(at + " contains the unregistered number '" + d.group() + "'");
      }
      Matcher e = BriefValidator.ENTITY.matcher(stripped);
      while (e.find()) {
        if (!turn.entities().contains(e.group()) && !allowedIds.contains(e.group())
            && (px == null || !px.entities.contains(e.group()))) {
          problems.add(at + " names unsupported entity " + e.group());
        }
      }
      for (String f : forbidden) {
        if (Pattern.compile("\\b" + Pattern.quote(f.toLowerCase()) + "\\w*", Pattern.CASE_INSENSITIVE)
            .matcher(s.text()).find()) {
          problems.add(at + " uses forbidden wording '" + f + "'");
        }
      }
      if (BriefValidator.MARKUP.matcher(s.text()).find() || BriefValidator.INJECTION.matcher(s.text()).find()) {
        problems.add(at + " contains a link, markup or an instruction to the reader");
      }
      if (px != null) {
        Matcher u = BriefValidator.TIER_UPPER.matcher(stripped);
        while (u.find()) {
          if (!u.group(1).equals(px.tier)) {
            problems.add(at + " says " + u.group(1) + " but the computed tier is " + px.tier);
          }
        }
        Matcher w = BriefValidator.TIER_WORDS.matcher(stripped);
        while (w.find()) {
          if (!w.group(1).toUpperCase().equals(px.tier)) {
            problems.add(at + " says '" + w.group() + "' but the computed tier is " + px.tier);
          }
        }
      }
    }
    return problems;
  }
}

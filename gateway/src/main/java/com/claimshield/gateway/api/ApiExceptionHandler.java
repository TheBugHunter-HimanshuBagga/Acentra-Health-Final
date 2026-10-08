package com.claimshield.gateway.api;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class ApiExceptionHandler {

  private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

  private ResponseEntity<Object> respond(HttpStatus s, String code, String title, String detail,
      List<Map<String, String>> errors) {
    return ResponseEntity.status(s).contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(Problems.of(s, code, title, detail, errors));
  }

  @ExceptionHandler(ApiException.class)
  ResponseEntity<Object> api(ApiException e) {
    return respond(e.status(), e.code(), e.title(), e.getMessage(), e.errors());
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<Object> invalid(MethodArgumentNotValidException e) {
    List<Map<String, String>> errs = new ArrayList<>();
    e.getBindingResult().getFieldErrors()
        .forEach(f -> errs.add(Map.of("field", f.getField(), "message", String.valueOf(f.getDefaultMessage()))));
    return respond(HttpStatus.UNPROCESSABLE_ENTITY, "VALIDATION_FAILED", "Validation failed",
        "The request body is not valid.", errs);
  }

  @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class,
      MissingServletRequestParameterException.class})
  ResponseEntity<Object> unreadable(Exception e) {
    return respond(HttpStatus.UNPROCESSABLE_ENTITY, "VALIDATION_FAILED", "Validation failed",
        "The request could not be read: check field names and allowed values.", List.of());
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<Object> unexpected(Exception e) {
    log.error("Unhandled error", e);
    return respond(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Unexpected error",
        "Something went wrong. The incident was logged.", List.of());
  }
}

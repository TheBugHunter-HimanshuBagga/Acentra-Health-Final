package com.claimshield.gateway.config;

import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Runs every state-changing operation under one process-wide lock AND one database transaction.
 *
 * Why the lock: the audit log is a hash chain (each row hashes the previous row). Two concurrent writers could
 * both read the same "last hash" and fork the chain, and SQLite WAL readers do not block. The gateway is the only
 * writer of wf_* tables, so a single lock makes the chain linear. Throughput is irrelevant at this scale.
 */
@Component
public class Tx {

  private final ReentrantLock lock = new ReentrantLock();
  private final TransactionTemplate template;

  public Tx(PlatformTransactionManager tm) {
    this.template = new TransactionTemplate(tm);
  }

  /** Runs body in a transaction; any exception rolls back (including the audit rows written inside it). */
  public <T> T write(Supplier<T> body) {
    lock.lock();
    try {
      return template.execute(status -> body.get());
    } finally {
      lock.unlock();
    }
  }

  public void write(Runnable body) {
    write(() -> {
      body.run();
      return null;
    });
  }
}

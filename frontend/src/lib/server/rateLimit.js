const rateLimitMap = new Map();

// Periodically clean up entries older than 30 minutes to prevent memory growth
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitMap.entries()) {
      if (now - record.startTime > 30 * 60 * 1000) {
        rateLimitMap.delete(key);
      }
    }
  }, 10 * 60 * 1000);
}

export function checkRateLimit(key, { limit = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  const record = rateLimitMap.get(key) || { count: 0, startTime: now };

  if (now - record.startTime > windowMs) {
    record.count = 1;
    record.startTime = now;
  } else {
    record.count += 1;
  }

  rateLimitMap.set(key, record);

  if (record.count > limit) {
    const retryAfter = Math.ceil((record.startTime + windowMs - now) / 1000);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, retryAfter),
    };
  }

  return { allowed: true };
}

"""Temperature model for daily house heat, validated against a rolling mean."""
from datetime import timedelta
from statistics import mean


def heating_degrees(temperature):
    return max(0, 18 - temperature)


def fit(samples):
    if len(samples) < 21:
        return None
    x = [heating_degrees(temp) for _, temp, _ in samples]
    y = [heat for _, _, heat in samples]
    if max(x) - min(x) < 5:
        return None
    x_mean, y_mean = mean(x), mean(y)
    slope = sum((a - x_mean) * (b - y_mean) for a, b in zip(x, y)) / sum(
        (a - x_mean) ** 2 for a in x
    )
    if slope <= 0:
        return None
    base = max(0, y_mean - slope * x_mean)
    return lambda temp: base + slope * heating_degrees(temp)


def validated_model(samples):
    """Compare predictions on unseen days using observed weather for each day."""
    errors = []
    for index in range(max(21, len(samples) - 14), len(samples)):
        day, temperature, heat = samples[index]
        training = samples[:index]
        model = fit(training)
        recent = [value for date, _, value in training if date >= day - timedelta(days=14)]
        if model and len(recent) >= 7:
            errors.append((abs(model(temperature) - heat), abs(mean(recent) - heat)))
    if len(errors) >= 7 and sum(a for a, _ in errors) < .95 * sum(b for _, b in errors):
        return fit(samples)
    return None

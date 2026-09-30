"""DSPy 3.4 optimizers with explicit heuristic mode and training-set evaluation."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class Target:
    instruction: str


@dataclass
class Example:
    input: dict[str, str]
    expected: str

    @classmethod
    def from_dict(cls, value: dict) -> "Example":
        inputs = value["input"]
        if not inputs or any(not isinstance(k, str) or not k.isidentifier() or k in {"expected", "answer"} for k in inputs):
            raise ValueError("Input fields must be non-empty Python identifiers other than expected or answer")
        if any(not isinstance(v, str) for v in inputs.values()):
            raise ValueError("Input values must be strings")
        if not isinstance(value["expected"], str) or not value["expected"]:
            raise ValueError("Expected answer must be a non-empty string")
        return cls(input=inputs, expected=value["expected"])


@dataclass
class CompileResult:
    instruction: str
    demos: list[dict[str, dict[str, str]]]
    metric_before: float | None
    metric_after: float | None
    reasoning: str
    strategy: str
    mode: str


def make_lm():
    """Construct a credential-backed LM; missing DSPy or credentials is an error."""
    if not os.environ.get("DEEPSEEK_API_KEY"):
        raise ValueError("DEEPSEEK_API_KEY is required in DSPy mode")
    import dspy
    return dspy.LM(
        os.environ["DSPY_MODEL"],
        api_key=os.environ["DEEPSEEK_API_KEY"],
        api_base=os.environ["DEEPSEEK_BASE_URL"],
        cache=False,
    )


def _score(student, trainset, metric_fn) -> float:
    # Prediction failures reject the run; they are not measured zero scores.
    return sum(float(metric_fn(example, student(**example.inputs()))) for example in trainset) / len(trainset)


def compile_program(
    strategy: str, target: Target, trainset: list[Example], metric: str,
    options: dict, mode: str = "dspy",
) -> CompileResult:
    if strategy not in {"gepa", "miprov2", "bootstrapFewShot"}:
        raise ValueError("Unsupported optimizer")
    if mode not in {"dspy", "heuristic"} or metric not in {"exact_match", "contains"}:
        raise ValueError("Unsupported mode or metric")
    if not target.instruction.strip():
        raise ValueError("Instruction must not be empty")
    max_rounds = options["maxRounds"]
    max_demos = options["maxDemos"]
    if not isinstance(max_rounds, int) or not 1 <= max_rounds <= 20:
        raise ValueError("maxRounds must be an integer from 1 to 20")
    if not isinstance(max_demos, int) or not 0 <= max_demos <= 16:
        raise ValueError("maxDemos must be an integer from 0 to 16")
    if mode == "heuristic":
        return CompileResult(
            instruction=_improve_instruction(target.instruction), demos=[],
            metric_before=None, metric_after=None, strategy=strategy, mode=mode,
            reasoning="Deterministic heuristic rewrite; no DSPy optimizer, model calls, or evaluation.",
        )
    if not trainset:
        raise ValueError("DSPy requires labeled training examples")
    keys = set(trainset[0].input)
    if any(set(example.input) != keys for example in trainset):
        raise ValueError("All examples must have the same input field names")
    import dspy
    fields = {key: (str, dspy.InputField()) for key in sorted(keys)}
    fields["answer"] = (str, dspy.OutputField())
    student = dspy.Predict(dspy.Signature(fields, target.instruction))
    examples = [dspy.Example(**example.input, answer=example.expected).with_inputs(*sorted(keys)) for example in trainset]

    def metric_fn(example, prediction, trace=None):
        answer = prediction.answer.strip()
        expected = example.answer.strip()
        return float(expected in answer if metric == "contains" else expected == answer)

    lm = make_lm()
    with dspy.context(lm=lm):
        before = _score(student, examples, metric_fn)
        if strategy == "bootstrapFewShot":
            optimizer = dspy.BootstrapFewShot(
                metric=metric_fn, max_bootstrapped_demos=max_demos,
                max_labeled_demos=max_demos, max_rounds=max_rounds,
            )
            compiled = optimizer.compile(student, trainset=examples)
        elif strategy == "miprov2":
            optimizer = dspy.MIPROv2(
                metric=metric_fn, auto=None, num_candidates=max(2, max_rounds),
                max_bootstrapped_demos=max_demos, max_labeled_demos=max_demos,
            )
            compiled = optimizer.compile(
                student, trainset=examples, valset=examples,
                num_trials=max_rounds, minibatch=False,
            )
        else:
            def feedback_metric(gold, prediction, trace=None, pred_name=None, pred_trace=None):
                score = metric_fn(gold, prediction)
                return {"score": score, "feedback": f"Reference answer: {gold.answer}"}

            optimizer = dspy.GEPA(
                metric=feedback_metric, max_full_evals=max_rounds, reflection_lm=lm,
            )
            compiled = optimizer.compile(student, trainset=examples, valset=examples)
        compiled.demos = compiled.demos[:max_demos]
        after = _score(compiled, examples, metric_fn)
    demos = [
        {"input": {key: str(demo[key]) for key in sorted(keys)}, "output": {"answer": str(demo.answer)}}
        for demo in compiled.demos[:max_demos]
    ]
    return CompileResult(
        instruction=compiled.signature.instructions, demos=demos,
        metric_before=before, metric_after=after, strategy=strategy, mode=mode,
        reasoning=f"DSPy {strategy}; scores measured on {len(examples)} training examples, not held-out validation.",
    )


def _improve_instruction(instruction: str) -> str:
    hint = "Ground claims in the provided context and prefer concise, verifiable answers."
    return instruction if hint.lower() in instruction.lower() else f"{instruction.strip()}\n\n{hint}"

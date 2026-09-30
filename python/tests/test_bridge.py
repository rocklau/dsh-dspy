"""Keyless protocol and actual DSPy 3.4 constructor/signature regressions."""
import contextlib
import io
import os
import unittest
from unittest.mock import patch

from dsh_dspy.bridge import handle
from dsh_dspy.optimizers import Example, Target, compile_program
from dsh_dspy.rlm import build_rlm_plan


class BridgeTests(unittest.TestCase):
    def request(self, mode="heuristic"):
        return {"id": 1, "method": "compile", "params": {
            "strategy": "gepa", "mode": mode, "target": {"instruction": "Answer the question."},
            "trainset": [{"input": {"question": "Question?"}, "expected": "yes"}],
            "metric": "exact_match", "options": {"maxRounds": 2, "maxDemos": 1},
        }}

    def test_heuristic_is_explicit_and_unmeasured(self):
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}):
            result = handle(self.request())["result"]
            self.assertEqual(result["mode"], "heuristic")
            self.assertIsNone(result["metricBefore"])
            self.assertIsNone(result["metricAfter"])
            self.assertIn("no DSPy optimizer", result["reasoning"])
            self.assertIn("error", handle(self.request("dspy")))

    def test_provider_errors_do_not_disclose_secret_text_or_become_success(self):
        with patch("dsh_dspy.bridge.compile_program", side_effect=RuntimeError("sensitive-secret")):
            response = handle(self.request("dspy"))
        self.assertNotIn("result", response)
        self.assertNotIn("sensitive-secret", str(response))
        self.assertIn("RuntimeError", response["error"]["message"])

    def test_scaffold_is_valid_python_and_does_not_invent_tools(self):
        plan = build_rlm_plan('quotes " \\ and emoji 🐍', "context\nline", [])
        scope = {}
        exec(compile(plan.code, "<scaffold>", "exec"), scope)
        self.assertEqual(scope["solve"]()["answer"], None)
        self.assertNotIn("search", plan.plan)

    def test_invalid_labeled_examples_are_rejected(self):
        with self.assertRaises(ValueError):
            Example.from_dict({"input": {"answer": "not an input"}, "expected": "yes"})
        with self.assertRaises(ValueError):
            Example.from_dict({"input": {"task": 1}, "expected": "yes"})

    def test_actual_bootstrap_optimizer_returns_evaluated_instruction_and_demos(self):
        import dspy
        lm = dspy.utils.DummyLM([{"answer": "yes"}] * 50)
        examples = [Example({"question": "Question?"}, "yes")]
        with patch("dsh_dspy.optimizers.make_lm", return_value=lm), contextlib.redirect_stdout(io.StringIO()):
            result = compile_program("bootstrapFewShot", Target("Answer."), examples, "exact_match", {"maxRounds": 1, "maxDemos": 1})
        self.assertEqual(result.metric_before, 1)
        self.assertEqual(result.metric_after, 1)
        self.assertEqual(result.mode, "dspy")
        self.assertEqual(result.demos[0]["output"]["answer"], "yes")

    def test_real_gepa_and_mipro_constructors_and_compile_signatures(self):
        import dspy
        examples = [Example({"question": "Question?"}, "yes")]
        for strategy, optimizer in [("gepa", dspy.GEPA), ("miprov2", dspy.MIPROv2)]:
            with self.subTest(strategy=strategy):
                lm = dspy.utils.DummyLM([{"answer": "yes"}] * 50)
                with patch("dsh_dspy.optimizers.make_lm", return_value=lm), patch.object(
                    optimizer, "compile", autospec=True, side_effect=lambda _optimizer, student, **_options: student,
                ) as compiled:
                    result = compile_program(strategy, Target("Answer."), examples, "contains", {"maxRounds": 2, "maxDemos": 1})
                self.assertEqual(result.metric_after, 1)
                self.assertEqual(result.strategy, strategy)
                self.assertEqual(compiled.call_count, 1)

    def test_prediction_failure_is_not_a_zero_score(self):
        import dspy
        with patch("dsh_dspy.optimizers.make_lm", return_value=dspy.utils.DummyLM([])):
            with self.assertRaises(Exception):
                compile_program("gepa", Target("Answer."), [Example({"question": "Question?"}, "yes")], "exact_match", {"maxRounds": 1, "maxDemos": 0})


if __name__ == "__main__":
    unittest.main()

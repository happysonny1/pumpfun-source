#!/usr/bin/env python3
"""Mutation tests ensuring the byte comparator cannot hide code/padding changes."""
import struct
import unittest
from types import SimpleNamespace
import deep_section_analysis
import analyze
from compare import compare
class ComparisonTests(unittest.TestCase):
    def test_equal(self): self.assertTrue(compare(b'abc\0\0',b'abc\0\0')['full_byte_equality'])
    def test_code_mutation(self): self.assertEqual(compare(b'abc\0\0',b'axc\0\0')['first_difference'],1)
    def test_padding_mutation(self): self.assertEqual(compare(b'abc\0\0',b'abc\0x')['first_difference'],4)
    def test_truncated_padding(self): self.assertFalse(compare(b'abc\0\0',b'abc\0')['full_byte_equality'])
    def test_extended_padding(self): self.assertFalse(compare(b'abc\0',b'abc\0\0')['full_byte_equality'])
    def test_empty(self): self.assertEqual(compare(b'a',b'')['first_difference'],0)


class RelocationTargetTests(unittest.TestCase):
    def test_target_section_uses_address_not_file_offset(self):
        blob = bytearray(64)
        struct.pack_into('<QQ', blob, 0, 0x1000, 2)
        elf = SimpleNamespace(
            b=bytes(blob),
            symbols={},
            lo=0x2000,
            hi=0x3000,
            secs={
                '.rel.dyn': (0, 9, 0, 0, 0, 16, 0, 0, 1, 16),
                '.rodata': (0, 1, 2, 0x1000, 0x20, 0x100, 0, 0, 1, 0),
            },
        )
        report = deep_section_analysis.analyze_relocations(elf)
        self.assertEqual(report['entries'][0]['target_section'], '.rodata')


class MathComparisonPatternTests(unittest.TestCase):
    def analyze(self, instructions):
        # Keep the window above the analyzer's five-arithmetic-op threshold.
        prefix = struct.pack('<BBhi', 0x07, 1, 0, 1) * 4
        blob = prefix + b''.join(instructions)
        elf = SimpleNamespace(b=blob, entries=[0], hi=len(blob), funcs=[])
        return deep_section_analysis.analyze_math_patterns(elf)['math_intensive_windows'][0]

    def test_unsigned_comparisons_accept_immediate_and_register_forms(self):
        for arithmetic in (0x07, 0x0f, 0x17, 0x1f, 0x27, 0x2f):
            for comparison in (0x25, 0x2d, 0x35, 0x3d, 0xa5, 0xad, 0xb5, 0xbd):
                with self.subTest(arithmetic=hex(arithmetic), comparison=hex(comparison)):
                    report = self.analyze([
                        struct.pack('<BBhi', arithmetic, 0x21, 0, 1),
                        struct.pack('<BBhi', comparison, 0x31, 0, 0),
                    ])
                    self.assertEqual(report['overflow_checks'], 1)

    def test_unrelated_comparisons_and_intervening_instructions_stay_excluded(self):
        add = struct.pack('<BBhi', 0x07, 1, 0, 1)
        move = struct.pack('<BBhi', 0xb7, 2, 0, 1)
        for comparison in (0x15, 0x1d, 0x55, 0x5d, 0x65, 0x6d, 0xc5, 0xcd):
            with self.subTest(comparison=hex(comparison)):
                report = self.analyze([add, struct.pack('<BBhi', comparison, 0x31, 0, 0)])
                self.assertEqual(report['overflow_checks'], 0)
        report = self.analyze([add, move, struct.pack('<BBhi', 0x2d, 0x31, 0, 0)])
        self.assertEqual(report['overflow_checks'], 0)

    def test_captured_pump_subtract_compare_is_counted(self):
        # Pump file offset 0xd278: sub64 r1, r8; jge r1, r6, +7.
        blob = (analyze.ROOT / 'evidence/original/pump/deployed.so').read_bytes()
        pair = blob[0xd278:0xd288]
        self.assertEqual(pair.hex(), '1f810000000000003d61070000000000')
        self.assertEqual(self.analyze([pair])['overflow_checks'], 1)


class InstructionLogNameTests(unittest.TestCase):
    def names(self, name):
        blob = (analyze.ROOT / 'evidence/original' / name / 'deployed.so').read_bytes()
        return set(analyze.instruction_log_names(blob, analyze.known_instruction_names(name)))

    def test_idl_names_do_not_absorb_adjacent_text(self):
        pump = self.names('pump')
        self.assertIn('Buy', pump)
        self.assertIn('UpdateBuybackConfig', pump)
        self.assertIn('IdlResizeAccount', pump)
        self.assertNotIn('BuyCreateV2Disabled', pump)
        self.assertNotIn('UpdateBuybackConfigAn', pump)
        self.assertNotIn('IdlResizeAccountdata', pump)

        amm = self.names('pump_amm')
        self.assertIn('ClaimCashback', amm)
        self.assertIn('IdlCreateAccount', amm)
        self.assertNotIn('ClaimCashbacksol', amm)
        self.assertNotIn('IdlCreateAccountanchor', amm)

        fees = self.names('pump_fees')
        self.assertIn('Withdraw', fees)
        self.assertIn('CrankDonationFeePda', fees)
        self.assertNotIn('Withdrawaccountsol', fees)
        self.assertNotIn('CrankDonationFeePdaFee', fees)

    def test_program_names_fall_back_to_captures(self):
        self.assertEqual(
            analyze.program_names(),
            ['pump', 'pump_amm', 'pump_fees', 'mayhem'],
        )

    def test_mayhem_fallback_is_unchanged(self):
        names = self.names('mayhem')
        self.assertEqual(len(names), 25)
        self.assertIn('Buy', names)
        self.assertIn('InitializeGlobalParams', names)


if __name__=='__main__': unittest.main()

package com.msb.solana.gateway.controller;

import com.msb.solana.gateway.serialization.SolanaAddressValidator;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/v1/compliance")
public class ComplianceScreeningController {

    private final SolanaAddressValidator addressValidator;

    private static final Set<String> SANCTIONED_WALLETS = Set.of(
            "11111111111111111111111111111111",
            "SanctionedBadActorWallet1111111111111111111111"
    );

    public ComplianceScreeningController(SolanaAddressValidator addressValidator) {
        this.addressValidator = addressValidator;
    }

    @PostMapping("/screen-address")
    public ResponseEntity<Map<String, Object>> screenAddress(@RequestBody Map<String, String> request) {
        String address = request.get("address");

        if (address == null || !addressValidator.isValid(address)) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", "REJECTED",
                    "error", "Invalid Solana Base58 address format"
            ));
        }

        boolean isFlagged = SANCTIONED_WALLETS.contains(address);

        return ResponseEntity.ok(Map.of(
                "address", address,
                "riskScore", isFlagged ? 95 : 5,
                "sanctionsMatch", isFlagged,
                "verdict", isFlagged ? "FAIL_CLOSED_REJECT" : "CLEAR_TO_TRANSACT",
                "timestamp", System.currentTimeMillis()
        ));
    }
}
package com.msb.solana.gateway.controller;

import com.msb.solana.gateway.model.SettlementResult;
import com.msb.solana.gateway.service.ChannelSettlementService;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Administrative endpoint for triggering an on-chain settlement sweep of a
 * payment channel's cumulative verified amount.
 */
@RestController
@RequestMapping("/api/v1/settlement")
public class SettlementController {

    private final ChannelSettlementService settlementService;

    public SettlementController(ChannelSettlementService settlementService) {
        this.settlementService = settlementService;
    }

    @PostMapping("/channels/{channelId}/sweep")
    public SettlementResult sweepChannel(@PathVariable String channelId) {
        return settlementService.settleChannel(channelId);
    }
}

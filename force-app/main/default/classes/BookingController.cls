public without sharing class BookingController {

    public class PaymentResult {
        @AuraEnabled public Id paymentId;
        @AuraEnabled public String paymentUrl;
    }
    
    @AuraEnabled
    public static PaymentResult createUnitPayment(
        Id opportunityId,
        String paymentMode, String purpose, Decimal amount,
        String fieldsJson
    ){
        Map<String, Object> f = (fieldsJson != null && fieldsJson != '')
            ? (Map<String, Object>) JSON.deserializeUntyped(fieldsJson)
            : new Map<String, Object>();
    
        Unit_Payment__c p = new Unit_Payment__c();
    
        // ---- auto-populated context ----
        p.Opportunity__c   = opportunityId;
        p.OwnerId          = UserInfo.getUserId();
        p.Sales_Consultant__c = UserInfo.getUserId();
        p.Payment_Mode__c  = paymentMode;
        p.Purpose__c       = purpose;
        p.Amount__c        = String.valueOf(amount);
        p.Total_Amount__c  = amount;
        p.TotalAmount__c   = amount;
        p.PaymentStatus__c = 'Completed';
        p.Date_Acknowledged__c = Date.today();
    
        // ---- mode-specific ----
        if (paymentMode == 'Credit Card') {
            p.NameOnCard__c          = str(f, 'nameOnCard');
            p.CardType__c            = str(f, 'cardType');
            p.CardLast4Digits__c     = dec(f, 'cardLast4');
            p.CardExpiryMonthYear__c = str(f, 'cardExpiry');
            p.CardIssuingBank__c     = str(f, 'cardIssuingBank');
            p.Installments__c        = str(f, 'installments');
            p.Authorization_Code__c  = str(f, 'authCode');
        } else if (paymentMode == 'Cheque') {
            p.ChequeNumber__c          = str(f, 'chequeNumber');
            p.BankName__c              = str(f, 'bankName');
            p.ChequeDate__c            = dt(f, 'chequeDate');
            p.ChequeClearanceDate__c   = dt(f, 'chequeClearanceDate');
            p.Cheque_Status__c         = str(f, 'chequeStatus');
        } else if (paymentMode == 'Cash') {
            p.ReceiptSent__c       = str(f, 'receiptSent');
            p.Date_Acknowledged__c = dt(f, 'dateAcknowledged') != null ? dt(f, 'dateAcknowledged') : Date.today();
        } else if (paymentMode == 'Bank Transfer') {
            p.SenderAccountName__c     = str(f, 'senderAccountName');
            p.BankReferenceNumber__c   = str(f, 'bankRefNumber');
            p.TransferReferenceUTR__c  = str(f, 'transferUTR');
            p.TransferDate__c          = dt(f, 'transferDate');
            p.BankName__c              = str(f, 'bankNameText');
        } else if (paymentMode == 'Wire Transfer') {
            p.SenderAccountName__c     = str(f, 'senderAccountName');
            p.SwiftCodeIBAN__c         = str(f, 'swiftIban');
            p.TransferReferenceUTR__c  = str(f, 'transferUTR');
            p.TransferDate__c          = dt(f, 'transferDate');
            p.BankName__c              = str(f, 'bankNameText');
            p.PaymentStatus__c         = 'Pending';
        }
    
        insert p;
    
        // Wire Transfer => set dummy payment URL on the record
        PaymentResult res = new PaymentResult();
        res.paymentId = p.Id;
        if (paymentMode == 'Wire Transfer') {
            String dummy = 'https://infobeanscloudtechlimited60-dev-ed.develop.my.site.com/paymentgetway' + p.Id;
            p.PaymentURL__c = dummy;
            p.PayModeGateWay__c = 'Wire Gateway';
            update p;
            res.paymentUrl = dummy;
        }
        return res;
    }
    
    /* ---- helpers ---- */
    private static String str(Map<String, Object> m, String k) {
        return m.containsKey(k) && m.get(k) != null ? String.valueOf(m.get(k)) : null;
    }
    private static Decimal dec(Map<String, Object> m, String k) {
        String v = str(m, k);
        return String.isBlank(v) ? null : Decimal.valueOf(v);
    }
    private static Date dt(Map<String, Object> m, String k) {
        String v = str(m, k);
        return String.isBlank(v) ? null : Date.valueOf(v);
    }
    
    @AuraEnabled(cacheable=true)
    public static List<Account> searchAccounts(String searchTerm) {
        String keyword = '%' + String.escapeSingleQuotes(searchTerm.trim()) + '%';
        return [
            SELECT Id, Name, Phone
            FROM Account
            WHERE Name LIKE :keyword
            ORDER BY Name
            LIMIT 10
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<Project__c> getProjects(){
        return [SELECT Id, Name FROM Project__c WHERE Active__c = true ORDER BY Name];
    }

    @AuraEnabled(cacheable=true)
    public static List<Property__c> getProperties(Id projectId){
        return [
            SELECT Id, Name 
            FROM Property__c 
            WHERE Project_Inv__c = :projectId
            ORDER BY Name
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<Unit__c> getUnits(Id propertyId){
        return [
            SELECT Id, Name 
            FROM Unit__c 
            WHERE Property__c = :propertyId
            AND Status__c = 'Available'
            ORDER BY Name
        ];
    }

    @AuraEnabled
    public static Id createBookingUnit(Id opportunityId, Id projectId, Id propertyId, Id unitId){
        // Fetch inventory related to property
        List<Inventory__c> inventoryList = [
            SELECT Id, Name, Status__c
            FROM Inventory__c 
            WHERE Property_Inv__c = :propertyId 
            //AND Status__c = 'Available'
            LIMIT 1
        ];
        
        Unit__c unit = [SELECT Id, Name, Status__c, Unit_Cost__c,Broker_Commission_Percent__c FROM Unit__c WHERE Id = :unitId];
        
        if(inventoryList.isEmpty()){
            throw new AuraHandledException('No available inventory found for the selected property.');
        }
        
        Inventory__c inventory = inventoryList[0];
        
        // Create Booking Unit
        Booking_Unit__c booking = new Booking_Unit__c();
        booking.Opportunity__c = opportunityId;
        booking.Unit__c = unitId;
        booking.Inventory__c = inventory.Id;
        booking.booking_status__c = 'Active';
        booking.Booking_Unit_Price__c = unit.Unit_Cost__c;
        booking.Name = unit.Name + ' - ' + (inventory.Name != null ? inventory.Name : inventory.Id);
        booking.Booking_Unit_Status__c = 'Booked';
        booking.Broker_Com__c= unit.Broker_Commission_Percent__c * unit.Unit_Cost__c / 100;
        booking.Broker_Com_Perc__c= unit.Broker_Commission_Percent__c;
        unit.Status__c = 'Booked';
        inventory.Status__c = 'Booked';
        inventory.NSA_Area_Sqft__c = 5000;
        
        try {
            insert booking;
            update unit;
            update inventory;
            return booking.Id;
        } catch (Exception e) {
            throw new AuraHandledException('Error while creating Booking Unit: ' + e.getMessage());
        }
    }

    @AuraEnabled
    public static void createJointOwners(List<Joint_Owner__c> jointOwners){
        try {
            insert jointOwners;
        } catch (Exception e) {
            throw new AuraHandledException('Error while creating Joint Owners: ' + e.getMessage());
        }
    }

    /* ===================================================================
       Inventory / Booking Unit creation flow
       (migrated from SelectUnitScreenController, formerly used by the
       standalone selectUnitScreen LWC; now called directly by
       bookingComponent's Step 2 — inventory selection & payment plans)
       =================================================================== */

    /**
* @description Fetches available Inventory units based on the Opportunity's Account.
* @param accountId The Id of the Account related to the Opportunity.
* @return A List of Inventory__c records.
*/
    @AuraEnabled
    public static List<Inventory__c> getInventoryUnits(Id accountId) {
        if (accountId == null) {
            return new List<Inventory__c>();
        }

        Set<Id> campaignIds = new Set<Id>();
        for(Campaign cmp : [SELECT Id FROM Campaign
                            WHERE Id IN (SELECT Campaign__c FROM CampaignMember__c
                                         WHERE Agency__c = :accountId)]) {
                                             campaignIds.add(cmp.id);
                                         }

        if (campaignIds.isEmpty()) {
            return new List<Inventory__c>();
        }

        List<Inventory__c> units = [SELECT Id, Name
                                    FROM Inventory__c
                                    WHERE Campaign__c IN :campaignIds and Status__c='Available'
                                    ORDER BY Name];
        return units;
    }

    @AuraEnabled
    public static List<Payment_Plan_Detail__c> getPaymentPlanDetails(List<Id> selectedInventoryIds) {
        if (selectedInventoryIds == null || selectedInventoryIds.isEmpty()) {
            return new List<Payment_Plan_Detail__c>();
        }

        return [
            SELECT Id, Name, Seq__c, Percent__c, Amount__c, Inventory_Name__c
            FROM Payment_Plan_Detail__c
            WHERE Payment_Plan_Master__c != NULL
            AND Payment_Plan_Master__r.isDefault__c = TRUE
            AND Payment_Plan_Master__r.Property__c IN :selectedInventoryIds
            ORDER BY Payment_Plan_Master__r.Property__c, Seq__c
        ];
    }

    /**
* @description Creates new Booking_Unit__c records linking an Opportunity to selected Inventories.
* @param opportunityId The Id of the current Opportunity.
* @param selectedInventoryIds A List of Ids from the selected Inventory__c records.
* @return A success message.
*/
    @AuraEnabled
    public static String createBookingUnits(Id opportunityId, List<Id> selectedInventoryIds) {
        if (opportunityId == null || selectedInventoryIds == null || selectedInventoryIds.isEmpty()) {
            throw new AuraHandledException('Opportunity ID and at least one Inventory ID are required.');
        }

        // Fetch the base Opportunity
        Opportunity sourceOpp = [
            SELECT Id, AccountId, Name, StageName, Account.Name, CloseDate
            FROM Opportunity
            WHERE Id = :opportunityId
            LIMIT 1
        ];

        // Fetch all selected inventory records
        Map<Id, Inventory__c> invMap = new Map<Id, Inventory__c>(
            [SELECT Id, Name, Sale_Price__c, Status__c FROM Inventory__c WHERE Id IN :selectedInventoryIds and Status__c='Available']
        );

        List<Opportunity> newOpps = new List<Opportunity>();
        Map<String, Id> invToOppMap = new Map<String, Id>();

        Boolean isFirst = true;

        for (Id invId : invMap.keyset()) {
            Inventory__c inv = invMap.get(invId);

            if (isFirst) {
                sourceOpp.StageName = 'Sold';
                sourceOpp.Amount = inv.Sale_Price__c;
                invToOppMap.put(inv.Name, sourceOpp.Id);
                isFirst = false;
            } else {
                Opportunity newOpp = new Opportunity(
                    Name = sourceOpp.Account.Name + '-' + inv.Name,
                    StageName = 'Sold',
                    CloseDate = Date.today().addMonths(1),
                    AccountId = sourceOpp.AccountId,
                    Amount = inv.Sale_Price__c
                );
                newOpps.add(newOpp);
                invToOppMap.put(invId, null);
            }
        }

        if (!newOpps.isEmpty()) {
            insert newOpps;
            for (Opportunity opp : newOpps) {
                String invName = '';
                if (opp.Name.contains('-')) {
                    invName = opp.Name.substringAfter('-').trim();
                } else {
                    invName = opp.Name;
                }
                invToOppMap.put(invName, opp.Id);
            }
        }

        // Update the first (existing) opportunity
        update sourceOpp;

        // Create Booking Units (1-to-1 mapping)
        List<Booking_Unit__c> bookings = new List<Booking_Unit__c>();
        for (Id invId : invMap.keyset()) {
            Id oppId = invToOppMap.get(invMap.get(invId).Name);
            bookings.add(new Booking_Unit__c(
                Name = sourceOpp.Account.Name +' - '+ invMap.get(invId).Name,
                Opportunity__c = oppId,
                Inventory__c = invId
            ));
        }

        // Update Inventories as booked
        List<Inventory__c> invToUpdate = new List<Inventory__c>();
        for (Inventory__c inv : invMap.values()) {
            inv.Status__c = 'Booked';
            invToUpdate.add(inv);
        }

        try {
            insert bookings;
            update invToUpdate;

            return 'Success: Created ' + bookings.size() +
                ' booking units and marked inventories as booked.';
        } catch (Exception e) {
            throw new AuraHandledException('Error while creating Booking Units: ' + e.getMessage());
        }
    }

    @AuraEnabled
    public static String finalizeBookingFlow(
        Id opportunityId,
        List<Id> selectedInventoryIds,
        String paymentMode,
        String purpose,
        Decimal amount,
        String fieldsJson,
        String jointOwnersJson
    ) {
        if (opportunityId == null) {
            throw new AuraHandledException('Opportunity ID is required.');
        }
        if (selectedInventoryIds == null || selectedInventoryIds.isEmpty()) {
            throw new AuraHandledException('Please select at least one inventory unit.');
        }
        if (String.isBlank(paymentMode) || amount == null) {
            throw new AuraHandledException('Payment Mode and Amount are required.');
        }

        try {
            createBookingUnits(opportunityId, selectedInventoryIds);

            List<Joint_Owner__c> ownersToInsert = new List<Joint_Owner__c>();
            if (!String.isBlank(jointOwnersJson)) {
                List<Object> ownerRows = (List<Object>) JSON.deserializeUntyped(jointOwnersJson);
                for (Object row : ownerRows) {
                    Map<String, Object> ownerMap = (Map<String, Object>) row;
                    String accountIdStr = ownerMap.containsKey('accountId') && ownerMap.get('accountId') != null
                        ? String.valueOf(ownerMap.get('accountId'))
                        : null;
                    String shareStr = ownerMap.containsKey('share') && ownerMap.get('share') != null
                        ? String.valueOf(ownerMap.get('share'))
                        : null;

                    if (String.isBlank(accountIdStr) || String.isBlank(shareStr)) {
                        continue;
                    }

                    ownersToInsert.add(new Joint_Owner__c(
                        Account__c = (Id) accountIdStr,
                        Share__c = Decimal.valueOf(shareStr),
                        Booking__c = opportunityId
                    ));
                }
            }

            if (!ownersToInsert.isEmpty()) {
                createJointOwners(ownersToInsert);
            }

            createUnitPayment(
                opportunityId,
                paymentMode,
                purpose,
                amount,
                fieldsJson
            );

            return 'Booking flow completed successfully.';
        } catch (Exception e) {
            throw new AuraHandledException('Error while finalizing booking flow: ' + e.getMessage());
        }
    }

     private static String formatIsoDate(Date value) {
        String month = String.valueOf(value.month()).leftPad(2, '0');
        String day = String.valueOf(value.day()).leftPad(2, '0');
        return value.year() + '-' + month + '-' + day;
    }
}
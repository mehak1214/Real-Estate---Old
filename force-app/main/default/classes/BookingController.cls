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

     private static String formatIsoDate(Date value) {
        String month = String.valueOf(value.month()).leftPad(2, '0');
        String day = String.valueOf(value.day()).leftPad(2, '0');
        return value.year() + '-' + month + '-' + day;
    }
}